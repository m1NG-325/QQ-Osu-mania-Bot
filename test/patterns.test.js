import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternGroup, groupedPatterns } from '../src/patterns.js';

test('pattern display folds subtypes into four groups without classifying breaks as notes',()=>{
  for(const [name,expected] of [['Chordjack','Jack'],['Trill','Stream'],['Jumpstream','JHS'],['Handstream','JHS'],['Jumpstream Tech','Tech'],['Wildcard','Tech'],['Coordination','Tech'],['Break',null],['Uncategorised',null]]) assert.equal(patternGroup(name),expected);
  assert.deepEqual(Object.fromEntries(groupedPatterns([['Jumpstream',15],['Handstream',10],['Tech',5],['Break',15]])),{JHS:25,Tech:5,Jack:0,Stream:0});
});
