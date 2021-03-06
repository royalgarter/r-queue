#!/usr/bin/env node

const async = require('async');
const util = require('util');
Object.assign(util.inspect.defaultOptions, {depth: 5, colors: process.env.HEROKU ? false : true, compact: true});

const T = { 
	PREFIX: process.env.TASK_QUEUE_PREFIX || 'TSKQ',
	TTL_SEC: 60*60*24*30,
	WAIT: 'WAIT',
	WORK: 'WORK',

	options: {
		enclosure: false,
	}
};

const json = o => JSON.stringify(o, null, 2);
const parse = str => { try { return typeof str == 'string' ? JSON.parse(str) : str} catch(ex) {return null} };
const urepl = name => name.replace(new RegExp(`${T.PREFIX}_Q_(${T.WAIT}|${T.WORK})_`, 'gi'), '');
const ujoin = (...args) => args.join('_').toUpperCase();
const sub = (type, name) => ujoin(T.PREFIX, 'Q', type, name);
const gid = (str, salt) => ujoin(T.PREFIX, 'ID', require('crypto').createHash('md5').update(str+(salt||'')).digest('hex').substr(0, 8));
const enqueue = (queues) => Array.isArray(queues) ? {queues, isArray: true} : {queues: [queues], isArray: false};
const sure = cb => { if (typeof cb == 'function') return cb; else throw new TypeError('Callback is missing or not a function'); }
const wrap = o => {
	o = typeof o == 'string' ? parse(o) : o;

	if (!o || typeof o != 'object') throw new TypeError('Task must be defined non-circular Object or Object in JSON format');

	let _tid = gid(json(o), Date.now());

	if (T.options.enclosure) {
		let task = Object.assign({_tid}, {task: o}); 
		return (task._json = json(task)) && task;
	}

	if (o._tid || o._json) throw new TypeError('Task mustn\'t have (_tid, _json) key or switch using "enclosure=true" options');
	
	return (o._tid = _tid) && (o._json = json(o)) && o;
}

T.push = (cli, qs, tsk, cb) => { //Push task to queue. The callback is returned with task id (_tid)
	let {queues, isArray} = enqueue(qs);
	tsk = wrap(tsk);

	async.map(queues, (q, next) => async.parallel([
		next => cli.setex(tsk._tid, T.TTL_SEC, tsk._json, next),
		next => cli.lpush(sub(T.WAIT, q), tsk._tid, next),
	], next), (e, r) => sure(cb)(e, tsk._tid, isArray ? r : r[0])); 
}

T._pull = (cli, q, isCircular=false, cb) => {
	async.waterfall([
		next => cli.rpoplpush(sub(T.WAIT, q), sub(isCircular?T.WAIT:T.WORK, q), next),
		(tid, next) => !tid ? next() : cli.get(tid, (e, r) => next(e, parse(r), tid)),
	], sure(cb)); 
}

T.pull = (cli, q, cb) => { // Standard pulling task from WAIT queue and push to WORK queue. The task should be deleted when finished
	T._pull(cli, q, false, cb); }

T.cpull = (cli, q, cb) => { // Circular pulling task from WAIT and repush to WAIT
	T._pull(cli, q, true, cb); }

T.ppull = (cli, qs, cb) => { //Pulling task from many queues as once
	let {queues, isArray} = enqueue(qs);

	async.eachSeries(queues, 
		(q, next) => T.pull(cli, q, (e, r) => next(r||e)), 
	e => (typeof e == 'object' && !(e instanceof Error) && !e.stack) ? sure(cb)(null, e) : sure(cb)(e) );
}	

T.lpull = (cli, q, t = {times:30, interval:1e3}, cb) => { // Long pulling from queue with retry option
	async.retry(t, next => T.pull(cli, q, (e,r) => next(!r ? (e||'Q_EMPTY') : null, r) ), sure(cb)); }

T.fpull = (cli, q, ms = 1e3, cb) => { //Return a stop function & setup forever pulling task from queue until pulled or the returned stop function is called
	cb = cb || (typeof ms == 'function' && ms);
	let stop = false;

	async.forever(next => T.pull(cli, q, (e, r) => (stop || r) ? next(stop || r) : setTimeout(next, ms)), 
					r => stop ? sure(cb)('STOPPED') : sure(cb)(null, r));

	return () => stop = true;
};

T.listen = (cli, q, cb, o = {keepAlive:true, interval:1e3}) => { //Listen on specific queue and callback whenever received a task
	async.forever(next => T.pull(cli, q, (e, r) => {
			if (e && !o.keepAlive) return next(e);
			if (r) cb(e, r);
			setTimeout(next, o.interval);
		}
	), e => sure(cb)(e));
};

T.len = (cli, qs, cb) => { //Get total tasks in queue
	let {queues, isArray} = enqueue(qs);

	async.map(queues, 
		(q, next) => async.map([
			sub(T.WAIT, q), 
			sub(T.WORK, q)
		], (sub,next) => cli.llen(sub, next), next), 
	(e, r) => sure(cb)(e, isArray ? r : r[0])) 
}

T.del = (cli, qs, tid, cb) => { //Delete specific task by ID when you finish it
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.parallel([
		next => cli.del(tid, next),
		next => cli.lrem(sub(T.WAIT, q), 1, tid, next),
		next => cli.lrem(sub(T.WORK, q), 1, tid, next),
	], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.reset = (cli, qs, tid, cb) => { //Reset specific task by ID in queue to WAIT
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.parallel([
		next => cli.lrem(sub(T.WAIT, q), 1, tid, next),
		next => cli.lrem(sub(T.WORK, q), 1, tid, next),
		next => cli.lpush(sub(T.WAIT, q), tid, next),
	], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.resetAll = (cli, qs, cb) => { //Reset all tasks in specific queue to WAIT
	let {queues, isArray} = enqueue(qs);

	async.map(queues, (q, next) => async.forever(
		next => cli.rpoplpush(sub(T.WORK, q), sub(T.WAIT, q), (e, r) => next(r ? null : 'DONE') & console.log(e,r))
	, e => next()), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.flush = (cli, qs, cb) => { //Flush all tasks in specific queue (both WAIT & WORK)
	let {queues, isArray} = enqueue(qs);
	
	async.map(queues, (q, next) => async.parallel([
		next => cli.del(sub(T.WAIT, q), next),
		next => cli.del(sub(T.WORK, q), next),
	], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
}

T.status = (cli, cb) => { //Get status of every queues
	async.waterfall([
		next => cli.keys(ujoin(T.PREFIX, 'Q','*'), next),
		(keys, next) => keys.sort() & async.map(keys, (k, next) => cli.llen(k, (e, l) => next(e, {
			[urepl(k)]: l,
			type: k.replace(`${T.PREFIX}_Q_`, ``).replace(`_${urepl(k)}`, ``), 
			raw: k,
		})), next),
	], (e, r) => sure(cb)(e, r));
}

T.wipe = (cli, wildcard, cb) => { //Wipe all queues & data
	async.waterfall([
		next => cli.keys(`*${T.PREFIX}*${wildcard||''}*`, next),
		(keys, next) => console.log('WIPED: ', keys) & cli.del(...keys, next),
	], sure(cb));
}

module.exports = exports = T;

try {
	(main => {
		const { program } = require('commander');

		program
			.option('-e, --execute', 'Run as CLI-EXECUTE mode')
			.option('-d, --debug', 'DEBUG mode')
			.option('-c, --cli <cmd>', 'Command to execute')
			.option('-r, --redis <redis>', 'Redis connection string')
			.option('-q, --queue <queue>', 'Queue name')
			.option('-v, --var <var>', 'Rest variables according to command', (v, p) => p.concat([v]), [])

		program.addHelpText('after', [
			`\nCommands (-c): `,
			...Object.keys(T)
				.filter(k => typeof T[k] == 'function' && !~k.indexOf('_'))
				.map(k => `  * ${k}:\t` + T[k].toString().split('\n')[0])
		].join('\n'));

		program.parse(process.argv);

		const options = program.opts();

		if (!~process.argv.indexOf('-e') && !~process.argv.indexOf('--execute')) return;

		options.redis = options.redis || process.env.REDIS_URL;
		
		if (!options.redis) return console.log('Redis <-r> is missing');
		if (!options.cli) return console.log('Command <-c> is missing');

		const redis = require('redis').createClient(options.redis);
		const _output = cmd => cmd || ((e,r) => console.log((options.debug ? `\n---\nCMD: ${options.cli}\nERR: ${e}\nRESULT:\n` : '') + json(r)) & redis.quit());

		const vars = [redis, ...(~['status', 'wipe'].indexOf(options.cli) ? [] : [_output(options.queue)]), ..._output(options.var), _output()];
		options.debug && console.log(`VARS: ${options.cli} ${vars.slice(1)}`);
		
		// console.log('vars', vars);
		return T[options.cli].apply(null, vars);
	})();
} catch (ex) {
	console.log('EXECUTE_CATCH:', ex);
}

// node task.js -e -q QTEST -c push -v "{\"a\":1}"
// node task.js -e -q QTEST -c pull
// node task.js -e -c status
