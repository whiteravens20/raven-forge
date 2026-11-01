// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { describe, it, expect } from 'vitest';
import { filterInstalled } from '../src/renderer/components/installed-filter';
import type { InstalledMod } from '../src/shared/ipc-types';

const mod = (name: string, fileName: string): InstalledMod => ({
  id: name,
  name,
  version: '1.0.0',
  source: 'modrinth',
  fileName,
  enabled: true,
  fromManifest: false,
});

const SODIUM = mod('Sodium', 'sodium-fabric-0.8.1+mc26.2.jar');
const FABRIC_API = mod('Fabric API', 'fabric-api-0.141.0+26.2.jar');
const IRIS = mod('Iris Shaders', 'iris-1.10.jar');
const ALL = [SODIUM, FABRIC_API, IRIS];

describe('filterInstalled', () => {
  it('finds a mod by part of its name, whatever the case', () => {
    expect(filterInstalled(ALL, 'SODI')).toEqual([SODIUM]);
  });

  it('finds a mod by its file, for what the name does not say', () => {
    expect(filterInstalled(ALL, 'mc26.2')).toEqual([SODIUM]);
  });

  it('wants every word, in any order, in the name or the file', () => {
    expect(filterInstalled(ALL, 'api fabric')).toEqual([FABRIC_API]);
    expect(filterInstalled(ALL, 'fabric sodium')).toEqual([SODIUM]);
    expect(filterInstalled(ALL, 'iris sodium')).toEqual([]);
  });

  it('keeps the order of the list', () => {
    expect(filterInstalled(ALL, 'a')).toEqual(
      [SODIUM, FABRIC_API, IRIS].filter((m) =>
        `${m.name}${m.fileName}`.toLowerCase().includes('a'),
      ),
    );
  });

  it.each(['', '   ', '\t'])('shows everything for %j', (query) => {
    expect(filterInstalled(ALL, query)).toEqual(ALL);
  });

  it('finds nothing where nothing matches', () => {
    expect(filterInstalled(ALL, 'create')).toEqual([]);
  });
});
