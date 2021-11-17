
# r-queue
Simple Redis Task Queue

**NodeJS Mode**

    const redis = require('redis').createClient(process.env.REDIS_URL);
    const nrq = require('@royalgarter/r-queue').create({
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
      -e, --execute          Run as CLI-EXECUTE mode
      -d, --debug            DEBUG mode
      -n, --enclosure        ENCLOSURE mode
      -c, --cmd <cmd>        Command to execute
      -r, --redis <redis>    Redis connection string
      -q, --queue <queue>    Queue name
      -p, --prefix <prefix>  Prefix name
      -v, --var <var>        Rest variables according to command (default: [])
      -h, --help             display help for command
    
    Commands (-c):
      * push:       (cli, qs, tsk, cb){// Push task to queue. The callback is returned with task id (_tid) >[ID, WAIT]
      * pull:       (cli, q, cb){// Standard pulling task from WAIT queue and push to WORK queue. The task should be deleted when finished
      * cpull:      (cli, q, cb){// Circular pulling task from WAIT and repush to WAIT
      * ppull:      (cli, qs, cb){// Pulling task from many queues as once
      * lpull:      (cli, q, t={times:30, interval:1e3}, cb){//  Long pulling from queue with retry option
      * fpull:      (cli, q, ms=1e3, cb){// Return a stop function & setup forever pulling task from queue until pulled or the returned stop function is called
      * listen:     (cli, q, o={keepAlive:true, interval:1e3, pause:false}, cb){// Listen on specific queue and callback whenever received a task
      * len:        (cli, qs, cb){// Get total tasks in queue >[WAIT, WORK]
      * del:        (cli, qs, tid, cb){// Delete specific task by ID when you finish it >[TASK, WAIT, WORK]
      * reset:      (cli, qs, tid, cb){// Reset specific task by ID in queue to WAIT >[WAIT, WORK, ID]
      * resetAll:   (cli, qs, cb){// Reset all tasks in specific queue to WAIT
      * flush:      (cli, qs, cb){// Flush all tasks in specific queue (both WAIT & WORK)
      * status:     (cli, cb){// Get status of every queues
      * wipe:       (cli, wildcard, cb){// Wipe all queues & data
      
      * pushAsync:   fn(...args) { // return Promise
      * pullAsync:   fn(...args) { // return Promise
      * cpullAsync:  fn(...args) { // return Promise
      * ppullAsync:  fn(...args) { // return Promise
      * lpullAsync:  fn(...args) { // return Promise
      * fpullAsync:  fn(...args) { // return Promise
      * listenAsync: fn(...args) { // return Promise
      * lenAsync:    fn(...args) { // return Promise
      * delAsync:    fn(...args) { // return Promise
      * flushAsync:  fn(...args) { // return Promise
      * statusAsync: fn(...args) { // return Promise
      * wipeAsync:   fn(...args) { // return Promise
	  * resetAsync:  fn(...args) { // return Promise
      * resetAllAsync: fn(...args) { // return Promise
    
    Examples: exec=(node task.js / nrq )
            node task.js -e -q QTEST -c push -v "{"a":1}"
            node task.js -e -q QTEST -c pull
            nrq -e -q QTEST -c len
            nrq -e -c status
