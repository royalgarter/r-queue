# nrq: [N]ode.js [R]edis [Q]ueue

* Work with CLI / required module / npx
* Rebrand from [@royalgarter/r-queue]
* [New Homepage](https://www.npmjs.com/package/nrq)

**Global Install**

    npm i nrq -g

**NPX Mode. One-shot without Installing**

Details at CLI Mode with replacing "nrq" to "npx -y nrq"

    npx -y nrq --help

**NodeJS Module**

    const redis = require('redis').createClient(process.env.REDIS_URL);
    const nrq = require('nrq').create({
        PREFIX: 'QAUTOBOT',
        ENCLOSURE: true,

        options: {
            redis,
            debug: true,
        },
    });

    const QUEUE = 'JUST_A_QUEUE_NAME';

    const event = new EventEmitter();
    const resume = nrq.listen(QUEUE, {keepAlive:true, pause: true}, (e, task) => {
        if (e) return event.emit('error', e);

        event.emit('task', task);
    });

    event.on('error', console.log);

    event.on('done', (task) => nrq.del(QUEUE, task._tid, (e, r) => console.log('task.deleted', e, r)));

    nrq.push(QUEUE, {data: 'a simple data'}, (e, r) => console.log('pushed', e, r));

 - [See more](https://github.com/royalgarter/r-queue/blob/main/test.js)

**CLI Mode & Lazy Documentation**

    Usage: task [options]

    Options:
      -e, --execute             Run as CLI-EXECUTE mode
      -d, --debug               DEBUG mode
      -n, --enclosure           ENCLOSURE mode
      -c, --cmd <cmd>           Command to execute
      -r, --redis <redis>       Redis connection string
      -q, --queue <queue>       Comma-separated queue name(s)
      -p, --prefix <prefix>     Prefix name
      -v, --var <var>           Rest variables according to command (default: [])
      -w, --pipevar             Append variable from pipeline shell |
      -x, --xredis <xredis...>  Using raw redis cli command
      -h, --help                display help for command

    Commands (-c):
      * emit:       (ev, args) => _emitter.emit(ev, args)
      * on: (ev, cb) => _emitter.on(ev, cb)
      * removeAllListeners: (ev) => _emitter.removeAllListeners(ev)
      * push:       (cli, qs, tsk, cb){// Push task to queue. The callback is returned with task id (_tid) >[ID, WAIT]
      * pull:       (cli, q, cb){// Standard pulling task from WAIT queue and push to WORK queue. The task should be deleted when finished
      * cpull:      (cli, q, cb){// Circular pulling task from WAIT and repush to WAIT
      * ppull:      (cli, qs, cb){// Pulling task from many queues as once
      * lpull:      (cli, q, t={times:30, interval:1e3}, cb){//  Long pulling from queue with retry option
      * fpull:      (cli, q, ms=1e3, cb){// Return a stop function & setup forever pulling task from queue until pulled or the returned stop function is called
      * listen:     (cli, q, o={keepAlive:true, interval:1e3, pause:false, visibility:0}, cb){// Listen on specific queue and callback whenever received a task
      * len:        (cli, qs, cb){// Get total tasks in queue >[WAIT, WORK]
      * del:        (cli, qs, tid, cb){// Delete specific task by ID when you finish it >[TASK, WAIT, WORK]
      * state:      (cli, qs, tid, cb){// Check the state of task by ID >[WAITING, WORKING]
      * reset:      (cli, qs, tid, cb){// Reset specific task by ID in queue to WAIT >[WAIT, WORK, ID]
      * resetAll:   (cli, qs, cb){// Reset all tasks in specific queue to WAIT
      * apush:      (cli, qs, tsk, cb){// Atomic push task to queue. The callback is returned with task id (_tid) >[ID, WAIT]
      * apull:      (cli, q, cb) {// Atomic pulling task from WAIT queue and push to WORK queue
      * status:     (cli, cb){// Get status of every queues
      * flush:      (cli, qs, cb){// Flush all tasks in specific queue (both WAIT & WORK)
      * wipe:       (cli, wildcard, cb){// Wipe all queues & data
      * version:    (...args){// Current version information
      * emitAsync:   fn(...args) {
      * onAsync:     fn(...args) {
      * removeAllListenersAsync:     fn(...args) {
      * pushAsync:   fn(...args) {
      * pullAsync:   fn(...args) {
      * cpullAsync:  fn(...args) {
      * ppullAsync:  fn(...args) {
      * lpullAsync:  fn(...args) {
      * fpullAsync:  fn(...args) {
      * listenAsync:         fn(...args) {
      * lenAsync:    fn(...args) {
      * delAsync:    fn(...args) {
      * stateAsync:  fn(...args) {
      * resetAsync:  fn(...args) {
      * resetAllAsync:       fn(...args) {
      * apushAsync:  fn(...args) {
      * apullAsync:  fn(...args) {
      * statusAsync:         fn(...args) {
      * flushAsync:  fn(...args) {
      * wipeAsync:   fn(...args) {
      * versionAsync:        fn(...args) {

    Examples: exec=(node nrq / nrq )
            node nrq -e -q QTEST -c push -v "{"a":1}"
            node nrq -e -q QTEST -c pull
            nrq -e -q QTEST -c len
            nrq -e -c status
            nrq -e -x set "TestRedisKey" "Hello World"

