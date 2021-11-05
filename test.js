const T = require('./task.js').create(null, {enclosure: true, debug: true, unsafe: true});
// const T = require('./task.js');

const async = require('async');
const util = require('util');
Object.assign(util.inspect.defaultOptions, {depth: 5, colors: process.env.HEROKU ? false : true, compact: true});
const cli = require('redis').createClient(process.env.REDIS_URL);

let QUEUE = 'QTEST';
let TESTCASE = process.argv.slice(2)[0];

switch (TESTCASE) {
	case 'listen': async.waterfall([
		next => async.times(10, (n, next) => T.push(cli, QUEUE, {date: new Date()}, (e, r) => next(e,r)), next),
		(id, next) => T.len(cli, QUEUE, (e, r) => next(e,id)),
	], e => {
		T.listen(cli, QUEUE, (e, r) => {
			if (e || !r) return;

			console.log('pulled', r);

			T.del(cli, QUEUE, r._tid);
		});
	})
	break;

	default: async.waterfall([
		next => async.times(1e3, (n, next) => T.push(cli, QUEUE, {date: new Date()}, (e, r) => next(e,r)), next),
		(id, next) => T.len(cli, 	QUEUE, (e, r) => next(e, id)),

		(id, next) => T.pull(cli, 	QUEUE, (e, r) => next(e, id)),
		(id, next) => T.cpull(cli, 	QUEUE, (e, r) => next(e, id)),
		(id, next) => T.fpull(cli, 	QUEUE, 1e3, (e, r) => next(e, id)),
		(id, next) => T.lpull(cli, 	QUEUE, {times: 30, interval: 200}, (e, r) => next(e, id)),
		
		(id, next) => T.len(cli, 	QUEUE, (e, r) => next(e, id)),
		(id, next) => T.reset(cli, 	QUEUE, id, (e, r) => next(e, id)),
		(id, next) => T.len(cli, 	QUEUE, (e, r) => next(e, id)),
		(id, next) => T.flush(cli, 	QUEUE, (e, r) => next(e, id)),
		(id, next) => T.len(cli, 	QUEUE, (e, r) => next(e, id)),
	])
}

