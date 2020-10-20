const T = require('task.js');
const async = require('async');
const cli = require('redis').createClient(process.env.REDIS_URL);

async.waterfall([
	next => T.push(cli, q, {data: 1}, (e, r) => console.log('push', e, r) & next(e,r)),
	(id, next) => T.len(cli, q, (e, r) => console.log('len', e, r) & next(e,id)),
	// (id, next) => T.pull(cli, q, (e, r) => console.log('pull', e, r) &  next(e,id)),
	(id, next) => T.fpull(cli, q, 1e3, (e, r) => console.log('fpull', e, r) &  next(e,id)),
	// (id, next) => T.lpull(cli, q, {times: 30, interval: 200}, (e, r) => console.log('lpull', e, r) &  next(e,id)),
	(id, next) => T.len(cli, q, (e, r) => console.log('len', e, r) & next(e,id)),
	(id, next) => T.reset(cli, q, id, (e, r) => console.log('reset', e, r) & next(e,id)),
	(id, next) => T.len(cli, q, (e, r) => console.log('len', e, r) & next(e,id)),
	// (id, next) => T.del(cli, q, id, (e, r) => console.log('del', e, r) & next(e,id)),
	(id, next) => T.flush(cli, q, (e, r) => console.log('flush', e, r) & next(e,id)),
	(id, next) => T.len(cli, q, (e, r) => console.log('len', e, r) & next(e,id)),
])