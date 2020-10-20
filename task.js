const async = require('async');
const md5 = require('crypto').createHash('md5');

const T = { PREFIX: process.env.TASK_QUEUE_PREFIX || 'TSKQ' };

const json = o => JSON.stringify(o);
const ujoin = (...args) => args.join('_').toUpperCase();
const sub = (type, name) => ujoin(T.PREFIX, type, name);
const gid = (str, salt) => ujoin(T.PREFIX, 'ID', md5.update(str+(salt||'')).digest('hex'));
const enqueue = (queues) => Array.isArray(queues) ? {queues, isArray: true} : {queues: [queues], isArray: false};
const wrap = o => {
	if (typeof o != 'object'||o._tid||o._json) throw new TypeError('Task must be non-circular Object without (_tid, _json) key');
	return (o._tid = gid(json(o), Date.now())) && (o._json = json(o)) && o;
}

T.push = (cli, qs, tsk, cb) => {
	let {queues, isArray} = enqueue(qs);
	tsk = wrap(tsk);

	async.map(queues, (q, next) => async.parallel([
		next => cli.set(tsk._tid, tsk._json, next),
		next => cli.lpush(sub('wait', q), tsk._tid, next),
	], next), (e, r) => cb(e, tsk._tid, isArray ? r : r[0])); 
}

T.pull = (cli, q, cb) => {
	async.waterfall([
		next => cli.rpoplpush(sub('wait', q), sub('work', q), next),
		(tid, next) => cli.get(tid, (e, r) => next(e, r, tid))
	], cb); 
}

T.lpull = (cli, q, t={times: 30,interval: 1e3}, cb) => async.retry(t, next => T.pull(cli, q, (e,r) => next(!r ? (e||'Q_EMPTY') : null, r) ), cb);

T.fpull = (cli, q, ms=1e3, cb) => async.forever(next => T.pull(cli, q, (e,r) => r ? next(r) : setTimeout(next, ms)), r => cb(null, r));

T.len = (cli, qs, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.map(queues, 
		(q, next) => async.map([
			sub('wait', q), 
			sub('work', q)
		], (sub,next) => cli.llen(sub, next), next), 
	(e, r) => cb(e, isArray ? r : r[0])) 
}

T.del = (cli, qs, tid, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.parallel([
		next => cli.del(tid, next),
		next => cli.lrem(sub('wait', q), 1, tid, next),
		next => cli.lrem(sub('work', q), 1, tid, next),
	], next), (e, r) => cb(e, isArray ? r : r[0]));
}

T.reset = (cli, qs, tid, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.parallel([
		next => cli.lrem(sub('wait', q), 1, tid, next),
		next => cli.lrem(sub('work', q), 1, tid, next),
		next => cli.lpush(sub('wait', q), tid, next),
	], next), (e, r) => cb(e, isArray ? r : r[0]));
}

T.flush = (cli, qs, cb) => {
	let {queues, isArray} = enqueue(qs);
	
	async.map(queues, (q, next) => async.parallel([
		next => cli.del(sub('wait', q), next),
		next => cli.del(sub('work', q), next),
	], next), (e, r) => cb(e, isArray ? r : r[0]));
}

T.wipe = (cli, wildcard, cb) => {
	cli.eval(`'local keys = redis.call("keys", ARGV[1]); return #keys > 0 and redis.call("del", unpack(keys)) or 0' 0 prefix:*${T.PREFIX}*${wildcard}`)
}

module.exports = exports = T;
