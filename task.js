#!/usr/bin/env node

const async = require('async');
const crypto = require('crypto');
const util = require('util');
Object.assign(util.inspect.defaultOptions, {depth: 3, colors: process.env.HEROKU ? false : true, compact: true});

const __create = (cfg, opt) => {
	const T = { 
		PREFIX: process.env.TASK_QUEUE_PREFIX || 'TSKQ',
		TTL_SEC: 60*60*24*30,
		WAIT: 'WAIT',
		WORK: 'WORK',
		ENCLOSURE: false,
		PROMISE: false,
		...(cfg || {}),

		options: { 
			enclosure: false, promise: false, debug: false, unsafe: false,
			...(cfg?.options || opt || {}),
		},
	};

	const REDIS = cfg?.redis || cfg?.options?.redis || opt?.redis;

	const _ = () => undefined;
	const json = o => JSON.stringify(o, (k,v) => v instanceof require('redis').RedisClient ? v.address : v, 2);
	const parse = str => { try { return typeof str == 'string' ? JSON.parse(str) : str} catch(ex) {return null} };
	const urepl = name => name.replace(new RegExp(`${T.PREFIX}_Q_(${T.WAIT}|${T.WORK})_`, 'gi'), '');
	const ujoin = (...args) => args.join('_').toUpperCase();
	const sub = (type, name) => ujoin(T.PREFIX, 'Q', type, name);
	const gid = (str, salt) => ujoin(T.PREFIX, 'ID', (crypto.randomUUID?.() || crypto.randomBytes(16).toString("hex")).replace(/-/g, ''));
	// const gid = (str, salt) => ujoin(T.PREFIX, 'ID', require('crypto').createHash('md5').update(str+(salt||'')).digest('hex').substr(0, 8));
	const enqueue = (queues) => Array.isArray(queues) ? {queues, isArray: true} : {queues: [queues], isArray: false};
	const sure = cb => {if (typeof cb == 'function') return cb;if (T.options.unsafe) return _; else throw new TypeError('Callback is missing or not a function');}
	const wrap = o => {
		o = typeof o == 'string' ? parse(o) : o;

		if (!o || typeof o != 'object') throw new TypeError('Task must be Defined Non-Circular Object or Object in JSON format');

		let _tid = gid(json(o), Date.now() + Math.random());

		if (T.ENCLOSURE || T.options.enclosure) {
			let task = Object.assign({_tid}, {task: o}); 
			return (task._json = json(task)) && task;
		}

		if (o._tid || o._json) throw new TypeError('Task couldn\'t has (_tid, _json) key OR enclosure using "this.options.enclosure=true"');
		
		return (o._tid = _tid) && (o._json = json(o)) && o;
	}

	if (T.options.debug) console.log(' >Task queue inited:', json(T));

	T.push = function(cli, qs, tsk, cb){// Push task to queue. The callback is returned with task id (_tid) >[ID, WAIT]
		let {queues, isArray} = enqueue(qs);
		tsk = wrap(tsk);

		async.map(queues, (q, next) => async.parallel([
			next => cli.setex(tsk._tid, T.TTL_SEC, tsk._json, next),
			next => cli.lpush(sub(T.WAIT, q), tsk._tid, next),
		], next), (e, r) => sure(cb)(e, tsk._tid, isArray ? r : r[0])); 
	}

	T._pull = function(cli, q, isCircular=false, cb) {
		async.waterfall([
			next => cli.rpoplpush(sub(T.WAIT, q), sub(isCircular?T.WAIT:T.WORK, q), next),
			(tid, next) => !tid ? next() : cli.get(tid, (e, r) => next(e, parse(r), tid)),
		], sure(cb)); 
	}

	T.pull = function(cli, q, cb){// Standard pulling task from WAIT queue and push to WORK queue. The task should be deleted when finished
		return T._pull(cli, q, false, cb); 
	}

	T.cpull = function(cli, q, cb){// Circular pulling task from WAIT and repush to WAIT
		return T._pull(cli, q, true, cb); 
	}

	T.ppull = function(cli, qs, cb){// Pulling task from many queues as once
		let {queues, isArray} = enqueue(qs);

		async.eachSeries(queues, 
			(q, next) => T._pull(cli, q, false, (e, r) => next(r||e)), 
		e => (typeof e == 'object' && !(e instanceof Error) && !e.stack) ? sure(cb)(null, e) : sure(cb)(e) );
	}	

	T.lpull = function(cli, q, t={times:30, interval:1e3}, cb){//  Long pulling from queue with retry option
		async.retry(t, next => T._pull(cli, q, false, (e,r) => next(!r ? (e||'Q_EMPTY') : null, r) ), sure(cb)); }

	T.fpull = function(cli, q, ms=1e3, cb){// Return a stop function & setup forever pulling task from queue until pulled or the returned stop function is called
		cb = cb || (typeof ms == 'function' && ms);
		let stop = false;

		async.forever(next => T._pull(cli, q, false, (e, r) => (stop || r) ? next(stop || r) : setTimeout(next, ms)), 
						r => stop ? sure(cb)('STOPPED') : sure(cb)(null, r));

		return (() => stop = true);
	};

	T.listen = function(cli, q, o={keepAlive:true, interval:1e3, pause:false}, cb){// Listen on specific queue and callback whenever received a task
		let pointer = null;
		let resume = () => pointer?.();

		cb = (typeof o === 'function' && typeof cb !== 'function') ? o : cb;
		o = {keepAlive:true, interval:1e3, pause:false, ...(typeof o === 'object' ? o : (cb || {}))};
		
		if (T.options.debug) console.log(' >Listened: ', o);
		async.forever(next => (pointer = null) & T._pull(cli, q, false, (e, r) => {
			if (e && !o?.keepAlive) return next(e);
			if (r && o?.pause) pointer = next;
			if (r) cb(e, r);
			if (r && o?.pause) return;
			setTimeout(next, o?.interval || 1e3);
		}), e => sure(cb)(e));
		return resume;
	};

	T.len = function(cli, qs, cb){// Get total tasks in queue >[WAIT, WORK]
		let {queues, isArray} = enqueue(qs);

		async.map(queues, 
			(q, next) => async.map([
				sub(T.WAIT, q), 
				sub(T.WORK, q)
			], (sub,next) => cli.llen(sub, next), next), 
		(e, r) => sure(cb)(e, isArray ? r : r[0])) 
	}

	T.del = function(cli, qs, tid, cb){// Delete specific task by ID when you finish it >[TASK, WAIT, WORK]
		let {queues, isArray} = enqueue(qs);

		async.map(queues, (q, next) => async.parallel([
			next => cli.del(tid, next),
			next => cli.lrem(sub(T.WAIT, q), 1, tid, next),
			next => cli.lrem(sub(T.WORK, q), 1, tid, next),
		], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
	}

	T.reset = function(cli, qs, tid, cb){// Reset specific task by ID in queue to WAIT >[WAIT, WORK, ID]
		let {queues, isArray} = enqueue(qs);
		let tids = enqueue(tid).queues;

		async.map(queues, (q, next) => async.each(tids, (id, next) => async.series([
			next => cli.lrem(sub(T.WAIT, q), 1, id, next),
			next => cli.lrem(sub(T.WORK, q), 1, id, next),
			next => cli.lpush(sub(T.WAIT, q), id, next),
		], next), next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
	}

	T.resetAll = function(cli, qs, cb){// Reset all tasks in specific queue to WAIT
		let {queues, isArray} = enqueue(qs);

		async.map(queues, (q, next) => async.forever(
			next => cli.rpoplpush(sub(T.WORK, q), sub(T.WAIT, q), (e, r) => next(r ? null : 'DONE'))
		, e => next()), (e, r) => sure(cb)(e, isArray ? r : r[0]));
	}

	T.flush = function(cli, qs, cb){// Flush all tasks in specific queue (both WAIT & WORK)
		let {queues, isArray} = enqueue(qs);
		
		async.map(queues, (q, next) => async.parallel([
			next => cli.del(sub(T.WAIT, q), next),
			next => cli.del(sub(T.WORK, q), next),
		], next), (e, r) => sure(cb)(e, isArray ? r : r[0]));
	}

	T.status = function(cli, cb){// Get status of every queues
		async.waterfall([
			next => cli.keys(ujoin(T.PREFIX, 'Q','*'), next),
			(keys, next) => keys.sort() & async.map(keys, (k, next) => cli.llen(k, (e, l) => next(e, {
				[urepl(k)]: l,
				type: k.replace(`${T.PREFIX}_Q_`, ``).replace(`_${urepl(k)}`, ``), 
				raw: k,
			})), next),
		], (e, r) => sure(cb)(e, r));
	}

	T.wipe = function(cli, wildcard, cb){// Wipe all queues & data
		async.waterfall([
			next => cli.keys(`*${T.PREFIX}*${wildcard||''}*`, next),
			(keys, next) => /*console.log('WIPED: ', keys) &*/ cli.del(...keys, next),
		], sure(cb));
	}

	T.version = function(...args){// Current version information
		const pkg = require(__dirname + '/package.json');
		const cb = args?.[args?.length - 1];
		if (typeof cb == 'function') cb(null, pkg?.version);
		return pkg?.version;
	}

	for (let key of Object.keys(T)) {
		if (typeof T[key] != 'function') continue;

		if (T.options.debug) {
			if (~key.indexOf('_')) continue;

			let fn = T[key];
			T[key] = (...args) => {
				let cb = args[args.length - 1];
				if (typeof cb == 'function')
					args[args.length - 1] = (...args2) => {
						console.log(` >nrq.${key}.done`, args2) 
						return cb.apply(null, args2)
					};
				console.log(` >nrq.${key}`, args.slice(1).slice(0,-1)) 
				return fn.apply(null, args);
			}
		}

		if (REDIS) {
			let fn = T[key];
			T[key] = (...args) => fn.apply(null, !(args?.[0] instanceof require('redis').RedisClient) ? [REDIS, ...args] : args);	
		}

		if (~key.indexOf('_')) continue;

		if (T.PROMISE || T.options.promise) {
			T[key] = util.promisify(T[key]);
		} else {
			T[key+'Async'] = util.promisify(T[key]);
		}
	}

	return T;
};

module.exports = exports = {...__create(), create: __create};

try { (main => {
	const { program } = require('commander');
	const pkg = require(__dirname + '/package.json');
	let T = __create();

	program
		.option('-e, --execute', 'Run as CLI-EXECUTE mode')
		.option('-d, --debug', 'DEBUG mode')
		.option('-n, --enclosure', 'ENCLOSURE mode')
		.option('-c, --cmd <cmd>', 'Command to execute')
		.option('-r, --redis <redis>', 'Redis connection string')
		.option('-q, --queue <queue>', 'Queue name')
		.option('-p, --prefix <prefix>', 'Prefix name')
		.option('-v, --var <var>', 'Rest variables according to command', (v, p) => p.concat([v]), [])

	program.addHelpText('before', [
		``,
		`Version: ${pkg?.version}`,
		`Readme: ${pkg?.homepage}`,
		``,
	].join('\n'));

	program.addHelpText('after', [
		`\nCommands (-c): `,
		...Object.keys(T)
			.filter(k => typeof T[k] == 'function' && !~k.indexOf('_'))
			.map(k => `  * ${k}:\t` + T[k]?.toString()?.split('\n')?.[0]?.replace('function', '')),
		`\nExamples: exec=(node task.js / nrq )`,
		`\tnode task.js -e -q QTEST -c push -v "{\"a\":1}"`,
		`\tnode task.js -e -q QTEST -c pull`,
		`\tnrq -e -q QTEST -c len`,
		`\tnrq -e -c status`,
	].join('\n'));

	program.parse(process.argv);

	const options = program.opts();

	if (!~process.argv.indexOf('-e') && !~process.argv.indexOf('--execute')) return;
	T = __create(options.prefix ? {PREFIX: options.prefix} : undefined, options);

	options.redis = options.redis || process.env.REDIS_URL;
	
	if (!options.redis) return console.log('Redis <-r> is missing');
	if (!options.cmd) return console.log('Command <-c> is missing');

	const redisOpts = {
		retry_unfulfilled_commands: true,
		retry_strategy: opts => {
			if (opts.error && opts.error.code === 'ECONNREFUSED') return new Error('The server refused the connection');
			if (opts.total_retry_time > 1000 * 60 * 60) return new Error('Retry time exhausted');
			if (opts.attempt > 10) return undefined;
			return Math.min(opts.attempt * 100, 3000);
		}
	}

	const redis = require('redis').createClient(options.redis, redisOpts);
	const _output = cmd => cmd || ((e,r) => console.log((options.debug ? `\n---\nCMD: ${options.cmd}\nERR: ${e}\nRESULT:\n` : '') + JSON.stringify(r, null, 2)) & redis.quit());

	const vars = [redis, ...(~['status', 'wipe'].indexOf(options.cmd) ? [] : [_output(options.queue)]), ..._output(options.var), _output()];
	options.debug && console.log(`VARS: ${options.cmd} ${vars.slice(1)}`);
	
	// console.log('vars', vars);
	return T[options.cmd].apply(null, vars);
})() } catch (ex) { console.log('EXECUTE_CATCH:', ex) }

// node task.js -e -q QTEST -c push -v "{\"a\":1}"
// node task.js -e -q QTEST -c pull
// node task.js -e -c status
