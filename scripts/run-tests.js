#!/usr/bin/env node
// Runs the same suite as tests.html, in Node.
'use strict';
const S = require('../strategy.js');
const G = require('../generator.js');
const T = require('../tests.js');
const odds = require('../strategy-odds.json');

const results = T.run(S, G, odds);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.msg ? '  — ' + r.msg : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
