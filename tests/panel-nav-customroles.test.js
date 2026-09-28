import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repoFile } from './_helpers.js';
import { canAccessPage } from '../src/services/panelAuth.js';

// El sidebar filtraba con canAccessPage(page, role) sin pasar customRoles: todo rol custom
// veía el menú vacío. Estos tests fijan la firma de 3 argumentos y el cableado que la usa.

const soporte = { id: 'soporte', label: 'Soporte', pages: { notes: { view: true, edit: false } } };

test('rol custom con notes.view=true ve notes, y con customRoles=[] no ve nada', () => {
  assert.equal(canAccessPage('notes', 'soporte', [soporte]), true);
  assert.equal(canAccessPage('notes', 'soporte', []), false);
});

test('el rol custom solo ve las páginas que tiene otorgadas', () => {
  assert.equal(canAccessPage('menu', 'soporte', [soporte]), false);
  assert.equal(canAccessPage('clients', 'soporte', [soporte]), false);
});

test('los roles built-in siguen por NAV_PERMS y no dependen de customRoles', () => {
  assert.equal(canAccessPage('notes', 'admin'), true);
  assert.equal(canAccessPage('notes', 'kitchen', [soporte]), false);
  // users es exclusivo de admin/superadmin: ni un rol custom con view lo habilita
  assert.equal(canAccessPage('users', 'soporte', [{ id: 'soporte', pages: { users: { view: true } } }]), false);
});

// Sin DOM no se puede montar el Sidebar; se verifica por fuente que las páginas involucradas
// pasan los argumentos correctos (el bug era exactamente un argumento de menos).
test('Sidebar y PanelPage cablean customRoles hacia canAccessPage', () => {
  const sidebar = repoFile('src/components/panel/Sidebar.jsx');
  assert.match(sidebar, /customRoles = \[\]/, 'Sidebar debe recibir customRoles con default []');
  assert.match(sidebar, /canAccessPage\(page, user\?\.role, customRoles\)/, 'Sidebar debe filtrar con customRoles');

  const panel = repoFile('src/pages/PanelPage.jsx');
  assert.match(panel, /customRoles=\{settings\.customRoles\}/, 'PanelPage debe pasar settings.customRoles al Sidebar');
  assert.match(panel, /canAccessPage\(activePage, user\?\.role, settings\.customRoles\)/, 'PanelPage debe corregir la pantalla activa con los permisos del rol');
});

test('NotesPage solo hace poll cuando la página está visible', () => {
  const notes = repoFile('src/components/panel/notes/NotesPage.jsx');
  assert.match(notes, /active = true/, 'NotesPage debe recibir active con default true');
  assert.match(notes, /if \(active && !document\.hidden/, 'el callback del intervalo debe mirar active');
  assert.match(notes, /\[active, refreshNotes, editing, rescheduling, showComprobantes\]/, 'active debe estar en las deps del efecto');

  const panel = repoFile('src/pages/PanelPage.jsx');
  assert.match(panel, /<NotesPage user=\{user\} active=\{activePage === 'notes'\}/, 'PanelPage debe pasarle si la página está activa');
});
