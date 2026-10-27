import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../public/legacy-app.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/legacy.css',import.meta.url),'utf8');
const ast=ts.createSourceFile('legacy-app.js',source,ts.ScriptTarget.Latest,true);
const helper=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='appointmentConflictGroups');
assert.ok(helper,'appointmentConflictGroups helper must exist');
const appointmentConflictGroups=vm.runInNewContext(helper.getText(ast)+'\nappointmentConflictGroups',{
 mins:value=>Number(value.slice(0,2))*60+Number(value.slice(3))
});
const appointment=(id,time,duration=60,status='scheduled')=>({id,time,duration,status});
const memberIds=group=>Array.from(group.appointments,item=>item.id);

test('desktop: two overlapping appointments get one shared conflict group',()=>{
 const groups=appointmentConflictGroups([appointment('b','09:30'),appointment('a','09:00')]);
 assert.equal(groups.length,1);
 assert.deepEqual(memberIds(groups[0]),['a','b']);
 assert.equal(groups[0].start,540);
 assert.equal(groups[0].end,630);
});

test('desktop: adjoining appointments and single appointments do not conflict',()=>{
 assert.equal(appointmentConflictGroups([appointment('a','09:00'),appointment('b','10:00')]).length,0);
 assert.equal(appointmentConflictGroups([appointment('a','09:00')]).length,0);
 assert.equal(appointmentConflictGroups([]).length,0);
});

test('desktop: chained overlaps form one outline, independent overlaps form another',()=>{
 const groups=appointmentConflictGroups([
  appointment('e','13:30',60),appointment('d','13:00',60),
  appointment('c','10:00',60),appointment('b','09:30',60),appointment('a','09:00',60)
 ]);
 assert.equal(groups.length,2);
 assert.deepEqual(memberIds(groups[0]),['a','b','c']);
 assert.deepEqual(memberIds(groups[1]),['d','e']);
});

test('desktop: cancelled appointments and invalid durations cannot trigger outlines',()=>{
 assert.equal(appointmentConflictGroups([appointment('a','09:00'),appointment('b','09:15',60,'cancelled')]).length,0);
 assert.equal(appointmentConflictGroups([appointment('a','09:00'),appointment('b','09:15',0)]).length,0);
});

test('desktop: outlines depend on real appointments, not manually blocked slots',()=>{
 assert.match(source,/appointmentConflictGroups\(dayAppointments\.get\(day\)\|\|\[\]\)/);
 assert.doesNotMatch(source,/appointmentConflictGroups\(ownerBlocks/);
 assert.match(source,/staffConflictOutlines=\(window\.AgendaAuth\|\|\{\}\)\.role!=="doctor"/);
 assert.match(source,/overlaps\.length>0&&!staffConflictOutlines/);
});

test('desktop: the shared border is red, rounded, and cannot capture clicks',()=>{
 assert.match(source,/class="calendar-conflict-outline" aria-hidden="true"/);
 assert.match(styles,/\.calendar-conflict-outline\{[^}]*pointer-events:none;[^}]*border:2px solid #d94352;[^}]*border-radius:11px/);
});
