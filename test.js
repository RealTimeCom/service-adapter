/* TEST FILE - Copyright (c) 2017 service-adapter - Tanase Laurentiu Iulian - https://github.com/RealTimeCom/service-adapter */

/*
TRAVIS  : https://travis-ci.org/RealTimeCom/service-adapter
RUN TESTS:
---------
$ npm test
	or
$ node test.js
*/

'use strict';

const adapter = require('./index.js');

// TO RUN A SINGLE TEST, ISOLATE OTHERS, BY COMMENT /* (function(){ TEST })(); */

// RUN TEST: PROTOCOL ======================================================================
(() => {

    const Readable = require('stream').Readable;

    class readStream extends Readable {
        constructor() {
            super();
            this.i = 0;
            //this.a=['{','"','f','"',':','"','t','"','}','\n'];
            // test non-blocking error
            this.a = ['{."f":"t"}\n{"f"', ':"t","b":3}\n0', '12{"f":"t","h":"abc"}\n']; // adapter onErr SyntaxError: Unexpected token . in JSON at position 1
        }
    }
    readStream.prototype._read = function() {
        this.push(this.i < this.a.length ? this.a[this.i] : null);
        this.i++;
    };

    const fc = {
        t: (head, body) => console.log('t call', head, body)
    };

    new readStream().
    on('data', data => console.log('read onData', data)).
    on('end', function() { console.log('read onEnd', this.i - 1); }).
    pipe(new adapter(fc, { data: 'obj', error: 'err' })). //,{end:false}
    on('err', e => console.log('adapter onErr', e)).
    on('error', e => console.log('adapter onError', e)).
    on('finish', () => console.log('adapter onFinish'));

})(); // END TEST

// RUN TEST: NETWORK ROUTER ================================================================
(() => {

    const sock = '/tmp/AaS.sock',
        fs = require('fs');
    try { // try to delete unix socket file `sock`
        const stats = fs.lstatSync(sock);
        if (stats && stats.isSocket()) { fs.unlinkSync(sock); }
    } catch (e) {}

    const functions = {
        func1: function(head, body) {
            console.log(this.name, 'func1 call');
            // call `AaC.func2`
            this.next('func2');
        },
        func2: function(head, body) {
            console.log(this.name, 'func2 call');
            // call `AaS.func3`
            this.next('func3');
            // optional, end client connection
            if (this.name === 'AaC') { this.client.end(); }
        },
        func3: function(head, body) {
            console.log(this.name, 'func3 call');
            // optional, close the server
            if (this.name === 'AaS') { this.server.close(); }
        }
        // ... and so on
    };

    require('net').createServer(function(socket) {

        // create the `AaS` adapter
        const AaS = new adapter(functions);
        // optional, adapter name
        AaS.name = 'AaS';
        // optional, create `this.server`, see `func3`
        AaS.server = this;
        // pipe `AaS` into `socket` stream
        socket.pipe(AaS).pipe(socket);

    }).listen('/tmp/AaS.sock', () => {

        require('net').connect('/tmp/AaS.sock', function() {

            // create the `AaC` adapter
            const AaC = new adapter(functions);
            // optional, adapter name
            AaC.name = 'AaC';
            // optional, create `this.client`, see `func2`
            AaC.client = this;
            // pipe `AaC` into `this` client stream
            this.pipe(AaC).pipe(this);
            // start data flow
            AaC.next('func1'); // call `AaS.func1`

        });

    });

})(); // END TEST

// RUN TEST: BASIC ROUTER ==================================================================
(() => {

    // object functions for adapter1
    const fc1 = {
        test1: (head, body) => console.log('test1 call', head, body.toString())
    };
    // object functions for adapter2
    const fc2 = {
        test2: function(head, body) {
            console.log('test2 call', head);
            // `adapter1` is next on the pipe, after `adapter2`
            // call function `test1` from `adapter1`
            this.next('test1', head, 'back');
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

})(); // END TEST

// RUN TEST: QUEUE =========================================================================
(() => {

    const functions = {
        job1: function(head, body) {
            console.log('job1 call');
            // set a task for 1s
            const t = this;
            setTimeout(() => {
                // the task is done
                console.log('job1 done');
                // exec the next job on the queue
                t.done();
            }, 1000);
        },
        job2: function(head, body) {
            console.log('job2 call');
            // add a job in the queue
            this.exec('job1');
            // exec the next job on the queue
            this.done();
        }
    };

    const adapter1 = new adapter(functions, { queue: false });
    // add two jobs
    adapter1.exec('job1').exec('job2');

    // {queue:true} - enable queue
    const adapter2 = new adapter(functions, { queue: true });
    // add jobs
    adapter2.exec('job1').exec('job1').exec('job1');

    console.log(adapter2.jobs().length);

})(); // END TEST
