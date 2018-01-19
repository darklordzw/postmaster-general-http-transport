'use strict';

/**
 * An HTTP transport module for postmaster-general.
 * @module index
 */

const querystring = require('querystring');
const bodyParser = require('body-parser');
const compression = require('compression');
const express = require('express');
const _ = require('lodash');
const rp = require('request-promise');
const rpErrors = require('request-promise/errors');
const Transport = require('postmaster-general-core').Transport;
const errors = require('postmaster-general-core').errors;
const defaults = require('./defaults');

/**
 * A postmaster-general transport module using HTTP.
 * @extends Transport
 */
class HTTPTransport extends Transport {
	/**
	 * Constructor for the HTTPTransport object.
	 * @param {object} [options] - Optional settings.
	 * @param {number} [options.port] - The port that Express should listen on. Defaults to 80.
	 * @param {boolean} [options.serveGzip] - Whether or not the transport should use gzip for express.js responses.
	 * @param {boolean} [options.sendGzip] - Whether or not to use gzip for published messages.
	 */
	constructor(options) {
		super(options);
		options = options || {};

		if (!_.isUndefined(options.port) && !_.isNumber(options.port)) {
			throw new TypeError('"options.port" should be a number.');
		}
		if (!_.isUndefined(options.serveGzip) && !_.isBoolean(options.serveGzip)) {
			throw new TypeError('"options.serveGzip" should be a boolean.');
		}
		if (!_.isUndefined(options.sendGzip) && !_.isBoolean(options.sendGzip)) {
			throw new TypeError('"options.sendGzip" should be a boolean.');
		}

		/**
		 * The port that Express should listen on.
		 * @type {number}
		 */
		this.port = options.port || defaults.port;

		/**
		 * Whether or not the transport should use gzip for express.js responses.
		 * @type {boolean}
		 */
		this.serveGzip = _.isUndefined(options.serveGzip) ? defaults.serveGzip : options.serveGzip;

		/**
		 * Whether or not the transport should use gzip for published requests.
		 * @type {boolean}
		 */
		this.sendGzip = _.isUndefined(options.sendGzip) ? defaults.sendGzip : options.sendGzip;

		this.app = express();
		this.server = null;

		// Turn on compression, if applicable.
		if (this.serveGzip) {
			this.app.use(compression());
		}

		// Make sure request bodies are automatically parsed into JSON.
		this.app.use(bodyParser.json());
		this.app.use(bodyParser.urlencoded({ extended: false }));

		// Register the router. We'll use this to swap out listeners on the fly.
		this.router = express.Router(); // eslint-disable-line new-cap
		this.app.use((req, res, next) => {
			this.router(req, res, next);
		});

		// Catch 404s and forward to error handler.
		this.app.use((req, res, next) => {
			next(new errors.NotFoundError('Not Found'));
		});

		// Top-level error handler
		this.app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
			err.response = err.response || { message: err.message };

			if (err instanceof errors.InvalidMessageError) {
				res.status(400).json(err.response);
			} else if (err instanceof errors.UnauthorizedError) {
				res.status(401).json(err.response);
			} else if (err instanceof errors.ForbiddenError) {
				res.status(403).json(err.response);
			} else if (err instanceof errors.NotFoundError) {
				res.status(404).json(err.response);
			} else {
				res.status(500).json(err.response);
			}
		});
	}

	/**
	 * Disconnects the transport from any services it references.
	 * @returns {Promise}
	 */
	disconnect() {
		return super.disconnect()
			.then(() => {
				if (this.server) {
					return new Promise((resolve) => {
						this.server.close(() => {
							resolve();
						});
					});
				}
			});
	}

	/**
	 * Processes a routing key into a format appropriate for the transport type.
	 * @param {string} routingKey - The routing key to convert.
	 * @returns {string}
	 */
	resolveTopic(routingKey) {
		return super.resolveTopic(routingKey).replace(/:/g, '/');
	}

	/**
	 * Adds a new message handler.
	 * @param {string} routingKey - The routing key of the message to handle.
	 * @param {Function} callback - The function to call when a new message is received.
	 * @param {object} [options] - Optional params for configuring the handler.
	 * @returns {Promise}
	 */
	addListener(routingKey, callback, options) {
		return super.addListener(routingKey, callback, options)
			.then((callbackWrapper) => {
				options = options || {};
				options.httpMethod = (options.httpMethod || 'get').toLowerCase();

				const topic = this.resolveTopic(routingKey);

				const handler = (req, res, next) => {
					const msg = options.httpMethod === 'get' || options.httpMethod === 'delete' ? req.query : req.body;
					callbackWrapper(msg, req.headers['x-pmg-correlationid'], req.headers['x-pmg-initiator'])
						.then((response) => {
							res.status(200).json(response || {});
						})
						.catch((err) => {
							next(err);
						});
				};

				switch (options.httpMethod) {
					case 'get':
						this.router.get(`/${topic}`, handler);
						break;
					case 'post':
						this.router.post(`/${topic}`, handler);
						break;
					case 'put':
						this.router.put(`/${topic}`, handler);
						break;
					case 'delete':
						this.router.delete(`/${topic}`, handler);
						break;
					case 'all':
						this.router.all(`/${topic}`, handler);
						break;
					default:
						throw new TypeError(`${options.httpMethod} is an unsupported method.`);
				}

				return handler;
			});
	}

	/**
	 * Deletes a message handler.
	 * @param {string} routingKey - The routing key of the handler to remove.
	 * @returns {Promise}
	 * @see {https://github.com/expressjs/express/issues/2596}
	 */
	removeListener(routingKey) {
		return super.removeListener(routingKey)
			.then(() => {
				const topic = this.resolveTopic(routingKey);
				const newRouter = express.Router(); // eslint-disable-line new-cap

				for (const handler of this.router.stack) {
					if (handler.route.method) {
						const method = handler.route.method.toLowerCase();
						for (const layer of handler.route.stack) {
							if (layer.path !== topic) {
								switch (method) {
									case 'get':
										newRouter.get(layer.path, layer.handle);
										break;
									case 'post':
										this.router.post(layer.path, layer.handle);
										break;
									case 'put':
										this.router.put(layer.path, layer.handle);
										break;
									case 'delete':
										this.router.delete(layer.path, layer.handle);
										break;
									default:
										newRouter.all(layer.path, layer.handle);
										break;
								}
							}
						}
					}
				}

				this.router = newRouter;
			});
	}

	/**
	 * Starts listening to messages.
	 * @returns {Promise}
	 */
	listen() {
		return super.listen()
			.then(() => {
				return new Promise((resolve) => {
					this.server = this.app.listen(this.port, () => {
						resolve();
					});
				});
			});
	}

	/**
	 * Publishes a fire-and-forget message that is not expected to return a meaningful response.
	 * @param {string} routingKey - The routing key to attach to the message.
	 * @param {object} [message] - The message data to publish.
	 * @param {object} [options] - Optional publishing options.
	 * @returns {Promise}
	 */
	publish(routingKey, message, options) {
		return this.request(routingKey, message, options);
	}

	/**
	 * Publishes an RPC-style message that waits for a response.
	 * @param {string} routingKey - The routing key to attach to the message.
	 * @param {object} [message] - The message data to publish.
	 * @param {object} [options] - Optional publishing options.
	 * @returns {Promise}
	 */
	request(routingKey, message, options) {
		return super.request(routingKey, message, options)
			.then((correlationId) => {
				const topic = this.resolveTopic(routingKey);
				message = message || {};
				options = options || {};
				options.headers = options.headers || {};
				options.headers['x-pmg-correlationid'] = correlationId;
				options.headers['x-pmg-initiator'] = options.initiator;

				const reqSettings = {
					uri: `${options.httpProtocol || 'http'}://${topic}${options.port ? ':' + options.port : ''}`,
					method: options.httpMethod || 'GET',
					headers: options.headers,
					json: typeof options.json === 'undefined' ? true : options.json,
					gzip: this.sendGzip
				};

				if (reqSettings.httpMethod === 'GET') {
					reqSettings.qs = querystring.stringify(message);
				} else {
					reqSettings.body = message;
				}

				return rp(reqSettings)
					.catch((err) => {
						if (err instanceof rpErrors.StatusCodeError) {
							switch (err.statusCode) {
								case 400:
									throw new errors.InvalidMessageError(err.error.message, err.response);
								case 401:
									throw new errors.UnauthorizedError(err.error.message, err.response);
								case 403:
									throw new errors.ForbiddenError(err.error.message, err.response);
								case 404:
									throw new errors.NotFoundError(err.error.message, err.response);
								default:
									throw new errors.ResponseProcessingError(err.error.message, err.response);
							}
						}
						throw new errors.RequestError(err);
					});
			});
	}
}

module.exports = HTTPTransport;
