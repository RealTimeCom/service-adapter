/* SOURCE FILE - Copyright (c) 2017 service-adapter - Tanase Laurentiu Iulian - https://github.com/RealTimeCom/service-adapter */

'use strict';

const Transform = require('stream').Transform;

class adapter extends Transform {
    constructor(f, opt) {
        super();
        this._b = 0; // private, body length
        this._h = null; // private, head object
        this._x = Buffer.allocUnsafeSlow(0); // private, create an un-pooled empty buffer
        this._c = this._x; // private, cache buffer
        this._f = f; // private, functions object
        this._s = Buffer.from('\n'); // private, separator
        this._q = []; // private, queue list
        this._j = true; // private, job status, if is free
        this.queue = typeof opt === 'object' && 'queue' in opt && typeof opt.queue === 'boolean' ? opt.queue : false; // public, queue status, if is enabled
        this.error = typeof opt === 'object' && 'error' in opt && typeof opt.error === 'string' ? opt.error : 'err'; // public, error event name
        this.limit = typeof opt === 'object' && 'limit' in opt && typeof opt.limit === 'number' ? parseInt(opt.limit) : Infinity; // public, number limit parser bytes
        this.qumax = typeof opt === 'object' && 'qumax' in opt && typeof opt.qumax === 'number' ? parseInt(opt.qumax) : Infinity; // public, number max queue jobs
        this.isOpen = true; // public, connection status, if is open
    }
}

adapter.prototype.next = function(func, head, body) {
    if (this.isOpen) { // verify the connection status
        if (typeof func === 'string') {
            if (body === undefined || body === null) {
                this.push(Buffer.concat([Buffer.from(JSON.stringify({ f: func, h: head })), this._s]));
            } else {
                if (!Buffer.isBuffer(body)) { body = Buffer.from(typeof body === 'string' ? body : body.toString()); }
                this.push(Buffer.concat([Buffer.from(JSON.stringify({ f: func, h: head, b: body.length })), this._s, body]));
            }
        } else { this.emit(this.error, new Error('invalid function name type [ ' + typeof func + ' ]')); }
    } else { this.emit(this.error, new Error('next() call after connection end')); }
    return this;
};

adapter.prototype.exec = function(func, head, body) {
    if (typeof func === 'string') {
        if (func in this._f) {
            if (this.queue) { // queue is enabled
                if (this._j) { // job is free
                    this._j = false; // set job busy
                    this._f[func].bind(this)(head, body); // exec job
                } else { // job is busy
                    if (this._q.length === this.qumax) {
                        this.emit(this.error, new Error('queue is full'));
                    } else {
                        // add job to the queue list
                        this._q.push({ func: func, head: head, body: body });
                    }
                }
            } else { // queue is disabled
                this.delq(); // make sure the queue list is empty
                this._f[func].bind(this)(head, body); // async exec job
            }
        } else { this.emit(this.error, new Error('invalid function name [ ' + func + ' ]')); }
    } else { this.emit(this.error, new Error('function not found')); }
    return this;
};

adapter.prototype.done = function() { // job is done
    if (this.queue) { // queue is enabled
        if (this._q[0]) { // got queue
            const j = this._q.shift(); // get the job and remove it from queue list
            this._f[j.func].bind(this)(j.head, j.body); // exec job
        } else { // queue is empty
            this._j = true; // set job free
        }
    } else { // queue is disabled
        this.delq(); // make sure the queue list is empty
    }
};

adapter.prototype.exeq = function() { // exec all queue jobs
    while (this._j === false) { this.done(); } // async exec jobs
};

adapter.prototype.delq = function() { // delete all queue jobs
    this._q = []; // empty queue list
    this._j = true; // set job free
};

adapter.prototype.jobs = function() {
    return this._q;
};

adapter.prototype._transform = function(data, enc, cb) {
    let c = true; // default, run cb()
    if (this._b === 0) { // head
        const l = this._c.length;
        if (l + data.length > this.limit) {
            this.emit(this.error, new Error('too many bytes'));
            this._c = this._x; // set empty cache
        } else {
            this._c = Buffer.concat([this._c, data]); // append data to cache
            const index = this._c.indexOf(this._s, l > 0 ? l - 1 : 0); // search for separator, move pointer one byte (separator length) back
            if (index !== -1) { // separator is found
                const left = this._c.slice(index + 1),
                    i = left.length; // extra bytes
                try {
                    const head = JSON.parse(this._c.slice(0, index).toString()); // deserialize head
                    if ('b' in head) { // body set
                        if (head.b > i) { // need more bytes, wait for next call
                            // set init object values
                            this._b = head.b;
                            this._h = head;
                            this._c = left; // set cache
                        } else {
                            if (head.b === i) { // got exact bytes
                                this.exec(head.f, head.h, left);
                                this._c = this._x; // no extra bytes, empty cache
                            } else { // got extra bytes
                                c = false; // no cb() run
                                this.exec(head.f, head.h, left.slice(0, head.b));
                                this._c = this._x; // set empty cache
                                this._transform(left.slice(head.b), enc, cb); // parse extra bytes
                            }
                        }
                    } else { // body is empty
                        this._c = this._x; // set empty cache
                        if (i === 0) {
                            this.exec(head.f, head.h);
                        } else {
                            c = false; // no cb() run
                            this.exec(head.f, head.h);
                            this._transform(left, enc, cb); // parse extra bytes
                        }
                    }
                } catch (e) { // got error
                    this.emit(this.error, e);
                    this._c = this._x; // set empty cache
                    if (i > 0) {
                        c = false; // no cb() run
                        this._transform(left, enc, cb); // parse extra bytes
                    }
                }
            } // else, need more bytes, wait for next call
        }
    } else { // body
        const i = this._c.length + data.length;
        if (this._b > i) { // need more bytes, wait for next call
            this._c = Buffer.concat([this._c, data]); // append data to cache
        } else {
            if (this._b === i) { // got exact bytes
                this.exec(this._h.f, this._h.h, Buffer.concat([this._c, data]));
                this._c = this._x; // no extra bytes, empty cache
                // reset init object values
                this._b = 0;
                this._h = null;
            } else { // got extra bytes
                const l = this._b - this._c.length;
                c = false; // no cb() run
                this.exec(this._h.f, this._h.h, Buffer.concat([this._c, data.slice(0, l)]));
                this._c = this._x; // set empty cache
                // reset init object values
                this._b = 0;
                this._h = null;
                this._transform(data.slice(l), enc, cb); // parse extra bytes
            }
        }
    }
    if (c) { cb(); }
};

adapter.prototype._flush = function(cb) {
    this.isOpen = false;
    cb();
};

module.exports = adapter;
