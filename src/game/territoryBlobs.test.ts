import { describe, expect, it } from 'vitest';
import { cellToChildren, gridDisk, latLngToCell } from 'h3-js';
import { blobFromCells, blobsFromCells, splitIntoBlobs } from './territoryBlobs';
import { GAMEPLAY } from '@/config/gameplay';
import type { CellId } from '@/types';

const BUDAPEST = { lat: 47.4979, lng: 19.0402 };

function cellAt(lat: number, lng: number): CellId {
  return latLngToCell(lat, lng, GAMEPLAY.H3_RESOLUTION) as CellId;
}

describe('splitIntoBlobs', () => {
  it('egy összefüggő korongot EGY foltnak lát', () => {
    const cells = gridDisk(cellAt(BUDAPEST.lat, BUDAPEST.lng), 8) as CellId[];
    expect(splitIntoBlobs(cells)).toHaveLength(1);
  });

  it('a két, egymást nem érintő korong KÉT folt', () => {
    // Fél fok ~55 km — a két korong biztosan nem ér össze.
    const a = gridDisk(cellAt(BUDAPEST.lat, BUDAPEST.lng), 5) as CellId[];
    const b = gridDisk(cellAt(BUDAPEST.lat + 0.5, BUDAPEST.lng), 5) as CellId[];

    const components = splitIntoBlobs([...a, ...b]);

    expect(components).toHaveLength(2);
    expect(components.map((c) => c.length).sort()).toEqual([a.length, b.length].sort());
  });

  it('SAROKNÁL érintkező cellák is egy foltba kerülnek — a hatszögnek minden szomszédja élszomszéd', () => {
    const center = cellAt(BUDAPEST.lat, BUDAPEST.lng);
    const neighbour = (gridDisk(center, 1) as CellId[]).find((c) => c !== center)!;
    expect(splitIntoBlobs([center, neighbour])).toHaveLength(1);
  });

  it('üres bemenetre üres eredmény', () => {
    expect(splitIntoBlobs([])).toEqual([]);
  });
});

describe('blobFromCells', () => {
  it('a terület a cellaszámból jön, nem a poligonból', () => {
    const cells = gridDisk(cellAt(BUDAPEST.lat, BUDAPEST.lng), 6) as CellId[];
    const blob = blobFromCells(cells)!;

    expect(blob.cellCount).toBe(cells.length);
    expect(blob.areaM2).toBe(Math.round(cells.length * GAMEPLAY.CELL_AREA_M2));
  });

  /**
   * EZ A LÉNYEG: a tárolt körvonal nagyságrendekkel kevesebb pont, mint a
   * nyers hatszög-kerület, de a folt kiterjedése nem változik.
   */
  it('a körvonalat egyszerűsíti, a befoglaló méretet viszont megtartja', () => {
    const cells = gridDisk(cellAt(BUDAPEST.lat, BUDAPEST.lng), 20) as CellId[];
    const blob = blobFromCells(cells)!;

    const outer = blob.rings[0]!;
    // A nyers kerület 20-as gyűrűnél sok száz pont; a fűrészfog levágása után
    // ennek a töredéke marad.
    expect(outer.length).toBeLessThan(80);
    expect(outer.length).toBeGreaterThanOrEqual(4);

    // A gyűrű zárt.
    expect(outer[0]).toEqual(outer[outer.length - 1]);

    // A befoglaló doboz a korong átmérője. Két szomszédos res 12 cella közepe
    // ~16 m-re van egymástól, tehát 20 gyűrű ≈ 320 m sugár, ~650 m átmérő —
    // fokban ~0,006 szélességi fok. A tág határok a pontos h3-geometriának
    // hagynak helyet, a nagyságrendet viszont rögzítik.
    const heightDeg = blob.bbox.north - blob.bbox.south;
    expect(heightDeg).toBeGreaterThan(0.004);
    expect(heightDeg).toBeLessThan(0.012);
  });

  it('LYUKAS foltnál a lyukat külön gyűrűként tartja meg', () => {
    const center = cellAt(BUDAPEST.lat, BUDAPEST.lng);
    const disk = new Set(gridDisk(center, 6) as CellId[]);
    // A közepéből kiveszünk egy kis korongot — marad egy gyűrű alakú folt.
    for (const inner of gridDisk(center, 2) as CellId[]) disk.delete(inner);

    const blob = blobFromCells([...disk])!;

    expect(blob.rings.length).toBe(2);
    expect(blob.cellCount).toBe(disk.size);
  });

  it('az azonosító determinisztikus — ugyanaz a halmaz más sorrendben is ugyanazt adja', () => {
    const cells = gridDisk(cellAt(BUDAPEST.lat, BUDAPEST.lng), 4) as CellId[];
    const forward = blobFromCells(cells)!;
    const reversed = blobFromCells([...cells].reverse())!;

    expect(reversed.id).toBe(forward.id);
    expect(reversed.areaM2).toBe(forward.areaM2);
  });

  it('üres halmazra null', () => {
    expect(blobFromCells([])).toBeNull();
  });
});

describe('blobsFromCells', () => {
  it('a két külön területet két, saját területű foltként adja vissza', () => {
    const small = gridDisk(cellAt(BUDAPEST.lat, BUDAPEST.lng), 3) as CellId[];
    const large = gridDisk(cellAt(BUDAPEST.lat + 0.5, BUDAPEST.lng), 10) as CellId[];

    const blobs = blobsFromCells([...small, ...large]).sort((a, b) => a.areaM2 - b.areaM2);

    expect(blobs).toHaveLength(2);
    expect(blobs[0]!.cellCount).toBe(small.length);
    expect(blobs[1]!.cellCount).toBe(large.length);
    expect(blobs[0]!.areaM2).toBeLessThan(blobs[1]!.areaM2);
  });

  /**
   * A tömörített (uniform) blokk kibontva is egyetlen folt — ez a gyakori
   * eset a valódi adatban, ezért érdemes külön kimondani.
   */
  it('egy teljes res 9 blokk gyerekei egyetlen foltot alkotnak', () => {
    const block = latLngToCell(BUDAPEST.lat, BUDAPEST.lng, 9);
    const children = cellToChildren(block, GAMEPLAY.H3_RESOLUTION) as CellId[];

    const blobs = blobsFromCells(children);

    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.cellCount).toBe(children.length);
  });
});
