## Service Adapter
[![NPM](https://nodei.co/npm/service-adapter.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/service-adapter/)

[![Build Status](https://travis-ci.org/RealTimeCom/service-adapter.svg?branch=master)](http://travis-ci.org/RealTimeCom/service-adapter)

**Service Adapter - stream transform protocol with queue control**

```sh
$ npm install service-adapter
```
#### Run tests
Browse module (e.g. `node_modules/service-adapter`) install directory, and run tests:
```sh
$ npm test
# or
$ node test.js
```
Compare test results with <a href="https://travis-ci.org/RealTimeCom/service-adapter">travis run tests</a>.
#### Include in your script
```js
const adapter = require('service-adapter');
```
#### Socket adapter type
* `AaS` - Adapter as Server
* `AaC` - Adapter as Client

#### Diagram example
```
HTTP Server          DB Server
-----------          ---------
 AaC | AaC <----------> AaS
  ^                      ^
  |        Log Server    |
  |        ----------    |
  --------> AaS | AaC <---
```
#### Network router
A socket connection can `only` be made between two different socket adapter type, see the diagram above. You can use the same set of `functions` for different adapters.
```js
const functions = {
	func1: function(self, head, body){
		console.log(self.name, 'func1 call');
		// call `AaC.func2`
		self.next('func2');
	},
	func2: function(self, head, body){
		console.log(self.name, 'func2 call');
		// call `AaS.func3`
		self.next('func3');
		// optional, end `AaC.socket`
		if(self.name === 'AaC'){ self.socket.end(); }
	},
	func3: function(self, head, body){
		console.log(self.name, 'func3 call');
		// optional, close `AaS.server`
		if(self.name === 'AaS'){ self.server.close(); }
	}
	// ... and so on
};

require('net').createServer(function(serverSocket){

	// create the `AaS` adapter
	const AaS = new adapter(functions);
	// optional, adapter name
	AaS.name = 'AaS';
	// optional, create `self.server`, see `func3`
	AaS.server = this;
	// pipe `AaS` into server socket stream `serverSocket`
	serverSocket.pipe(AaS).pipe(serverSocket);

}).listen('/tmp/AaS.sock',function(){

	const clientSocket = require('net').connect('/tmp/AaS.sock',function(){

		// create the `AaC` adapter
		const AaC = new adapter(functions);
		// optional, adapter name
		AaC.name = 'AaC';
		// optional, create `self.socket`, see `func2`
		AaC.socket = this;
		// pipe `AaC` into client socket stream `clientSocket`
		clientSocket.pipe(AaC).pipe(clientSocket);
		// start data flow
		AaC.next('func1');// call `AaS.func1`

	});

});
// the `AaS` is listening on unix socket `/tmp/AaS.sock` and `AaC` is connecting to it
/*
Output:
------
AaS func1 call
AaC func2 call
AaS func3 call
*/
```
#### Basic router
Adapters can be use to create routers between internal app functions, without connecting to any socket. This way, you can split the code between multiple micro services (adapters) in the same application for individual maintenance and debugging.
```js
// object functions for adapter1
const fc1 = {
	test1: function(self, head, body){
		console.log('test1 call', head, body.toString());
	}
};
// object functions for adapter2
const fc2 = {
	test2: function(self, head, body){
		console.log('test2 call', head);
		// `adapter1` is next on the pipe, after `adapter2`
		// call function `test1` from `adapter1`
		self.next('test1', head, 'back');
	}
};
// adapters
const adapter1 = new adapter(fc1);
const adapter2 = new adapter(fc2);

// create a router, data flow logic
adapter1.pipe(adapter2).pipe(adapter1);

// call function `test2` from `adapter2`
adapter2.exec('test2', '_welcome');

// `adapter2` is next on the pipe, after `adapter1`
// call function `test2` from `adapter2`
adapter1.next('test2', 'welcome_');

// `adapter2.exec` has the same result as `adapter1.next` for the router created
/*
Output:
------
test2 call _welcome
test1 call _welcome back
test2 call welcome_
test1 call welcome_ back
*/
```
##### Adapter constructor `new adapter (functions[, options])`
* <b><code>functions</code></b> - Object functions list
* <b><code>options</code></b> - Object {`queue`:Boolean, `error`:String, `limit`:Number, `qumax`:Number}
* `queue` - enable queue, default: `false` (disabled)
* `error` - error event name, default: `err`
* `limit` - limit parser bytes, default: `Infinity`
* `qumax` - max queue jobs, default: `Infinity`

##### Adapter prototype function
* <b><code>exec (func[, head[, body]])</code></b> - call function `func` from this adapter
* <b><code>next (func[, head[, body]])</code></b> - call function `func` from next adapter on the pipe
* `head` - Value, can be any type (not function)
* `body` - Buffer or String
* <b><code>exeq ()</code></b> - execute all queue jobs
* <b><code>delq ()</code></b> - delete all queue jobs
* <b><code>jobs ()</code></b> - return all queue jobs

##### Function adapter `([self[, head,[ body]]])`
* `self` - Object, this adapter
* `head` - Value, can be any type (not function)
* `body` - Buffer

#### Enable queue
The adapter has an internal queue system, that is turned off by default. When queue is enabled, each adapter function execution '`adapter.exec`' (and pipe(adapter) exec) is considered as a job. The queue can be enabled on adapter init `new adapter(functions, {queue:true})` or later `adapter.queue=true`.
> <b>Attention</b>, call `self.done` at the end of each job (adapter function), in order to execute the next queue job, otherwise, if more jobs are added in queue, the queue list will increase until app is out of memory.

```js
const functions = {
	job1: function(self, head, body){
		console.log('job1 call');
		// set a task for 1s
		setTimeout(function(){
			// the task is done
			console.log('job1 done');
			// exec the next queue job
			self.done();
		},1000);
	},
	job2: function(self, head, body){
		console.log('job2 call');
		// add a job in the queue
		self.exec('job1');
		// exec the next queue job
		self.done();
	}
};
// by default, queue is disabled
const adapter1 = new adapter(functions);
// add jobs
adapter1.exec('job1').exec('job2');
/*
Output:
------
job1 call
job2 call
job1 call
job1 done
job1 done
*/

// {queue:true} - enable queue
const adapter2 = new adapter(functions, {queue:true});
// add jobs
adapter2.exec('job1').exec('job2');
/*
Output:
------
job1 call
job1 done
job2 call
job1 call
job1 done
*/
```
#### Disable queue
If queue is enabled on the adapter, there are two methods to disable it:

1. **Safe**. Async execute all queue jobs `adapter.exeq()` (this may take a while, depending on how many jobs are in the queue), then disable the queue `adapter.queue=false`.
2. **Unsafe** . Delete all queue jobs `adapter.delq()` (this is unsafe), then disable the queue `adapter.queue=false`.

#### Read queue
If queue is enabled, function `adapter.jobs()`, will return an array with all queue jobs. Use `adapter.jobs().length` to see how many jobs are in the queue, at a given time.

#### Error handling
The adapter emit, by default, the event named `err` for errors, to ensure the data flow (non-blocking state). For blocking state (no data flow), name it `error` on constructor options `{error:'error'}`, or later `adapter.error='error'`.
```js
// default adapter `err` error event name
new adapter(functions, {error:'err'}).
// adapter error `err` event, non-blocking mode
on('err', function(e){ console.log('adapter onErr', e); }).
// stream standard `error` event, blocking mode
on('error', function(e){ console.log('adapter onError', e); });
```

**For more informations, consult or run the <a href="https://github.com/RealTimeCom/service-adapter/blob/master/test.js"><b>test.js</b></a> file.**

--------------------------------------------------------
**Service Adapter** is licensed under the MIT license. See the included `LICENSE` file for more details.
