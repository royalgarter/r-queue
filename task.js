const async = require('async');

const T = { 
	PREFIX: process.env.TASK_QUEUE_PREFIX || 'TSKQ',
	TTL_SEC: 60*60*24*30, 
};

const json = o => JSON.stringify(o);
const parse = str => { try { return typeof str == 'string' ? JSON.parse(str) : str} catch(ex) {return null} };
const ujoin = (...args) => args.join('_').toUpperCase();
const sub = (type, name) => ujoin(T.PREFIX, 'Q', type, name);
const gid = (str, salt) => ujoin(T.PREFIX, 'ID', require('crypto').createHash('md5').update(str+(salt||'')).digest('hex'));
const enqueue = (queues) => Array.isArray(queues) ? {queues, isArray: true} : {queues: [queues], isArray: false};
const sure = cb => { if (typeof cb == 'function') return cb; else throw new TypeError('Callback is missing or not a function'); }
const wrap = o => {
	if (typeof o != 'object'||o._tid||o._json) throw new TypeError('Task must be non-circular Object without (_tid, _json) key');
	return (o._tid = gid(json(o), Date.now())) && (o._json = json(o)) && o;
}

T.push = (cli, qs, tsk, cb) => {
	let {queues, isArray} = enqueue(qs);
	tsk = wrap(tsk);

	async.map(queues, (q, next) => async.parallel([
		next => cli.setex(tsk._tid, T.TTL_SEC, tsk._json, next),
		next => cli.lpush(sub('wait', q), tsk._tid, next),
	], next), (e, r) => sure(cb)(e, tsk._tid, isArray ? r : r[0])); 
}

T._pull = (cli, q, isCircular=false, cb) => {
	async.waterfall([
		next => cli.rpoplpush(sub('wait', q), sub(isCircular?'wait':'work', q), next),
		(tid, next) => !tid ? next() : cli.get(tid, (e, r) => next(e, parse(r), tid)),
	], sure(cb)); 
}
T.pull = (cli, q, cb) => T._pull(cli, q, false, cb);
T.cpull = (cli, q, cb) => T._pull(cli, q, true, cb);

T.ppull = (cli, qs, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.eachSeries(queues, 
		(q, next) => T.pull(cli, q, (e, r) => next(r||e)), 
	e => (typeof e == 'object' && !(e instanceof Error) && !e.stack) ? sure(cb)(null, e) : sure(cb)(e) );
}	

T.lpull = (cli, q, t={times:30,interval:1e3}, cb) => async.retry(t, next => T.pull(cli, q, (e,r) => next(!r ? (e||'Q_EMPTY') : null, r) ), sure(cb));

T.fpull = (cli, q, ms=1e3, cb) => async.forever(next => T.pull(cli, q, (e,r) => r ? next(r) : setTimeout(next, ms)), r => sure(cb)(null, r));

T.len = (cli, qs, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.map(queues, 
		(q, next) => async.map([
			sub('wait', q), 
			sub('work', q)
		], (sub,next) => cli.llen(sub, next), next), 
	(e, r) => sure(cb)(e, isArray ? r : r[0])) 
}

T.del = (cli, qs, tid, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.parallel([
		next => cli.del(tid, next),
		next => cli.lrem(sub('wait', q), 1, tid, next),
		next => cli.lrem(sub('work', q), 1, tid, next),
	], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.reset = (cli, qs, tid, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.parallel([
		next => cli.lrem(sub('wait', q), 1, tid, next),
		next => cli.lrem(sub('work', q), 1, tid, next),
		next => cli.lpush(sub('wait', q), tid, next),
	], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.resetAll = (cli, qs, cb) => {
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.forever(
		next => cli.rpoplpush(sub('work', q), sub('wait', q), (e, r) => next(r ? null : 'DONE') & console.log(e,r))
	, e => next()), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.status = (cli, cb) => {
	async.waterfall([
		next => cli.keys(ujoin(T.PREFIX, 'Q','*'), next),
		(keys, next) => keys.sort() & async.map(keys, (k, next) => cli.llen(k, (e, l) => next(e, {[k]: l})), next),
	], cb);
}

T.flush = (cli, qs, cb) => {
	let {queues, isArray} = enqueue(qs);
	
	async.map(queues, (q, next) => async.parallel([
		next => cli.del(sub('wait', q), next),
		next => cli.del(sub('work', q), next),
	], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.wipe = (cli, wildcard, cb) => {
	cli.eval("for i, name in ipairs(redis.call('KEYS', ARGV[1])) do redis.call('DEL', name); end", 0, `prefix:*${T.PREFIX}*${wildcard}`, sure(cb));
}

module.exports = exports = T;
