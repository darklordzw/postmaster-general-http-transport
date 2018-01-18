/* eslint import/no-unassigned-import: 'off' */
/* eslint no-unused-vars: 'off' */
'use strict';

const chai = require('chai');
const dirtyChai = require('dirty-chai');
const sinon = require('sinon');
const supertest = require('supertest');
const HTTPTransport = require('../index');
const defaults = require('../defaults.json');

/* This sets up the Chai assertion library. "should" and "expect"
initialize their respective assertion properties. The "use()" functions
load plugins into Chai. "dirtyChai" just allows assertion properties to
use function call syntax ("calledOnce()" vs "calledOnce"). It makes them more
acceptable to the linter. */
const expect = chai.expect;
chai.should();
chai.use(dirtyChai);

describe('http-transport:', () => {
	let sandbox;

	before(() => {
		sandbox = sinon.createSandbox();
	});

	afterEach(() => {
		sandbox.reset();
	});

	describe('constructor:', () => {
		it('should properly initialize settings from defaults', () => {
			const transport = new HTTPTransport();
			transport.port.should.equal(defaults.port);
		});
		it('should properly initialize settings from input', () => {
			const transport = new HTTPTransport({ port: 1500 });
			transport.port.should.equal(1500);
		});
		it('should error on invalid input', () => {
			try {
				const transport = new HTTPTransport({ port: 'bob' });
			} catch (err) {
				return;
			}
			throw new Error('Failed to catch invalid input.');
		});
	});

	describe('connect:', () => {
		it('should return a promise that resolves', () => {
			const transport = new HTTPTransport();
			return transport.connect();
		});
	});

	describe('disconnect:', () => {
		it('should return a promise that resolves', () => {
			const transport = new HTTPTransport();
			return transport.disconnect();
		});
		it('should cleanup resources', () => {
			const transport = new HTTPTransport();
			return transport.listen()
				.then(() => transport.disconnect())
				.then(() => {
					transport.listening.should.be.false();
				});
		});
	});

	describe('resolveTopic:', () => {
		it('should catch invalid input', () => {
			try {
				const transport = new HTTPTransport();
				transport.resolveTopic(3353553);
			} catch (err) {
				return;
			}
			throw new Error('Failed to catch invalid input.');
		});
		it('should return the decoded input', () => {
			const transport = new HTTPTransport();
			const result = transport.resolveTopic('localhost:play_game');
			result.should.equal('localhost/play_game');
		});
	});

	describe('addListener:', () => {
		it('should return a promise that resolves', () => {
			const transport = new HTTPTransport();
			return transport.addListener('bob', (msg, correlationId, initiator) => {
				return Promise.resolve({ result: `Received ${JSON.stringify(msg)}, ${correlationId}, ${initiator}` });
			});
		});
		it('should catch invalid routingKey params', () => {
			const transport = new HTTPTransport();
			return transport.addListener(44444, (msg, correlationId, initiator) => {
				return Promise.resolve({ result: `Received ${JSON.stringify(msg)}, ${correlationId}, ${initiator}` });
			})
				.then(() => {
					throw new Error('Failed to catch invalid input.');
				})
				.catch((err) => {
					if (!(err instanceof TypeError)) {
						throw err;
					}
				});
		});
		it('should catch invalid callback params', () => {
			const transport = new HTTPTransport();
			return transport.addListener('bob')
				.then(() => {
					throw new Error('Failed to catch invalid input.');
				})
				.catch((err) => {
					if (!(err instanceof TypeError)) {
						throw err;
					}
				});
		});
		it('should register a working callback', () => {
			const transport = new HTTPTransport();
			return transport.addListener('bob', (msg, correlationId, initiator) => {
				return Promise.resolve({ result: `Received ${JSON.stringify(msg)}, ${correlationId}, ${initiator}` });
			})
				.then((handler) => {
					expect(handler).to.exist();
				})
				.then(() => transport.listen())
				.then(() => supertest(transport.app)
					.get('/bob')
					.set('X-PMG-CorrelationId', 'testCorrelationId')
					.set('X-PMG-Initiator', 'testInitiator')
					.expect('Content-Type', /json/)
					.expect(200)
					.then((response) => {
						response.body.result.should.equal('Received {}, testCorrelationId, testInitiator');
					}));
		});
	});

	// describe('removeListener:', () => {
	// 	it('should return a promise that resolves', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.removeListener('bob');
	// 	});
	// 	it('should catch invalid routingKey params', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.publish(35353535)
	// 			.then(() => {
	// 				throw new Error('Failed to catch invalid input.');
	// 			})
	// 			.catch((err) => {
	// 				if (!(err instanceof TypeError)) {
	// 					throw err;
	// 				}
	// 			});
	// 	});
	// 	it('should remove timing data for the listener', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.addListener('bob', () => {
	// 			return Promise.resolve();
	// 		})
	// 			.then(() => transport.recordTiming('bob', new Date().getTime()))
	// 			.then(() => {
	// 				expect(transport.timings.bob).to.exist();
	// 			})
	// 			.then(() => transport.removeListener('bob'))
	// 			.then(() => {
	// 				expect(transport.timings.bob).to.not.exist();
	// 			});
	// 	});
	// });

	// describe('listen:', () => {
	// 	it('should return a promise that resolves', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.listen();
	// 	});
	// 	it('should start listening', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.listen()
	// 			.then(() => {
	// 				transport.listening.should.be.true();
	// 			});
	// 	});
	// });

	// describe('publish:', () => {
	// 	it('should return a promise that resolves', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.publish('bob');
	// 	});
	// 	it('should catch invalid routingKey params', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.publish(35353535)
	// 			.then(() => {
	// 				throw new Error('Failed to catch invalid input.');
	// 			})
	// 			.catch((err) => {
	// 				if (!(err instanceof TypeError)) {
	// 					throw err;
	// 				}
	// 			});
	// 	});
	// 	it('should catch invalid correlationId params', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.publish('bob', {}, { correlationId: 44444 })
	// 			.then(() => {
	// 				throw new Error('Failed to catch invalid input.');
	// 			})
	// 			.catch((err) => {
	// 				if (!(err instanceof TypeError)) {
	// 					throw err;
	// 				}
	// 			});
	// 	});
	// 	it('should catch invalid initiator params', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.publish('bob', {}, { initiator: 44444 })
	// 			.then(() => {
	// 				throw new Error('Failed to catch invalid input.');
	// 			})
	// 			.catch((err) => {
	// 				if (!(err instanceof TypeError)) {
	// 					throw err;
	// 				}
	// 			});
	// 	});
	// });

	// describe('request:', () => {
	// 	it('should return a promise that resolves', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.request('bob');
	// 	});
	// 	it('should catch invalid routingKey params', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.request(35353535)
	// 			.then(() => {
	// 				throw new Error('Failed to catch invalid input.');
	// 			})
	// 			.catch((err) => {
	// 				if (!(err instanceof TypeError)) {
	// 					throw err;
	// 				}
	// 			});
	// 	});
	// 	it('should catch invalid correlationId params', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.request('bob', {}, { correlationId: 44444 })
	// 			.then(() => {
	// 				throw new Error('Failed to catch invalid input.');
	// 			})
	// 			.catch((err) => {
	// 				if (!(err instanceof TypeError)) {
	// 					throw err;
	// 				}
	// 			});
	// 	});
	// 	it('should catch invalid initiator params', () => {
	// 		const transport = new HTTPTransport();
	// 		return transport.request('bob', {}, { initiator: 44444 })
	// 			.then(() => {
	// 				throw new Error('Failed to catch invalid input.');
	// 			})
	// 			.catch((err) => {
	// 				if (!(err instanceof TypeError)) {
	// 					throw err;
	// 				}
	// 			});
	// 	});
	// });
});
