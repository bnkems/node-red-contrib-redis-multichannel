module.exports = function(RED) {
    "use strict";
    var redis = require("redis");
    var connection = {};
    var usingConn = {};

    function RedisConfig(n) {
        RED.nodes.createNode(this, n);
        this.host = n.host;
        this.port = n.port;
        this.dbase = n.dbase;
        this.pass = n.pass;
    }
    RED.nodes.registerType("redis-mc-config", RedisConfig);

    function RedisIn(n) {
        RED.nodes.createNode(this, n);
        this.server = RED.nodes.getNode(n.server);
        this.command = n.command;
        this.name = n.name;
        this.topic = n.topic;
        this.timeout = n.timeout;
        this.sto = null;
        this.topics = [];
        this.client = connect(this.server, true);
        var node = this;

        node.client.on('error', function(err) {
            if (err) {
                clearInterval(node.sto);
                node.error(err);
            }
        });

        node.on('close', function(done) {
            if (node.command === "psubscribe") {
                node.client.punsubscribe();
            }
            else if (node.command === "subscribe") {
                node.client.unsubscribe();
            }
            if (node.sto !== null) {
                clearInterval(node.sto);
                node.sto = null;
            }
            node.status({});
            node.client.end();
            node.topics = [];
            done();
        });

        node.topics = node.topic.split(' ');
        if (node.command === "psubscribe" || node.command === "subscribe") {
            node.client.on('subscribe', function(channel, count) {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "connected"
                });
            });
            node.client.on('psubscribe', function(channel, count) {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "connected"
                });
            });
            node.client.on('pmessage', function(pattern, channel, message) {
                var payload = null;
                try {
                    payload = JSON.parse(message);
                }
                catch (err) {
                    payload = message;
                }
                finally {
                    node.send({
                        pattern: pattern,
                        topic: channel,
                        payload: payload
                    });
                }
            });
            node.client.on('message', function(channel, message) {
                var payload = null;
                try {
                    payload = JSON.parse(message);
                }
                catch (err) {
                    payload = message;
                }
                finally {
                    node.send({
                        topic: channel,
                        payload: payload
                    });
                }
            });
            node.client[node.command](node.topics);
        }
        else {
            node.topics.push(node.timeout);
            node.sto = setInterval(function() {
                node.client[node.command](node.topics, function(err, data) {
                    if (err) {
                        node.error(err);
                    }
                    else {
                        if (data !== null && data.length == 2) {
                            var payload = null;
                            try {
                                payload = JSON.parse(data[1]);
                            }
                            catch (err) {
                                payload = data[1];
                            }
                            finally {
                                node.send({
                                    payload: payload
                                });
                            }
                        }
                        else {
                            node.send({
                                payload: null
                            });
                        }
                    }
                });
            }, 100);
            node.status({
                fill: "green",
                shape: "dot",
                text: "connected"
            });
        }
    }
    RED.nodes.registerType("redis-mc-in", RedisIn);

    function RedisOut(n) {
        RED.nodes.createNode(this, n);
        this.server = RED.nodes.getNode(n.server);
        this.command = n.command;
        this.name = n.name;
        this.topic = n.topic;
        var node = this;

        var client = connect(node.server);

        node.on('close', function(done) {
            node.status({});
            disconnect(node.server);
            done();
        });

        node.on('input', function(msg) {
            var topic;
            if (msg.topic !== undefined && msg.topic !== "") {
                topic = msg.topic;
            }
            else {
                topic = node.topic;
            }
            try {
                client[node.command](topic, JSON.stringify(msg.payload));
            }
            catch (err) {
                node.error(err);
            }
        });

    }
    RED.nodes.registerType("redis-mc-out", RedisOut);

    function connect(config, force) {
        var options = {};

        var idx = config.pass + '@' + config.host + ':' + config.port + '/' + config.dbase;

        if (force !== undefined || usingConn[idx] === undefined || usingConn[idx] === 0) {
            if (config.pass !== "") {
                options['auth_pass'] = config.pass;
            }
            if (config.dbase !== "") {
                options['db'] = config.dbase;
            }

            var conn = redis.createClient(config.port, config.host, options);
            conn.on('error', function(err) {
                console.log('[redis]', err);
            });
            if (force !== undefined && force === true) {
                return conn;
            }
            else {
                connection[idx] = conn;
                if (usingConn[idx] === undefined) {
                    usingConn[idx] = 1;
                }
                else {
                    usingConn[idx]++;
                }
            }
        }
        else {
            usingConn[idx]++;
        }
        return connection[idx];
    }

    function disconnect(config) {
        var idx = config.pass + '@' + config.host + ':' + config.port + '/' + config.dbase;
        if (usingConn[idx] !== undefined) {
            usingConn[idx]--;

        }
        if (usingConn[idx] <= 0) {
            connection[idx].end();
        }
    }
};
