import type { LatLng } from '../../../src/game/geo';
import type { RouteCharacter } from '../lib/directions';

export type RouteBenchmarkActivity = 'walk' | 'run' | 'bike';
export type RouteBenchmarkTerrain = 'flat' | 'hilly';
export type RouteBenchmarkJunctions = 'simple' | 'complex';

export interface RouteBenchmarkCase {
  id: string;
  name: string;
  origin: LatLng;
  activity: RouteBenchmarkActivity;
  profile: 'walking' | 'cycling';
  targetKm: number;
  bearingDeg: number;
  character: RouteCharacter;
  terrain: RouteBenchmarkTerrain;
  junctions: RouteBenchmarkJunctions;
}

export const ROUTE_BENCHMARK_CORPUS_VERSION = 'budapest-v1';

/**
 * Fixed public-space origins around Budapest. The labels describe the intended
 * coverage of the corpus; they are not assertions about route quality.
 */
export const BUDAPEST_ROUTE_BENCHMARK_CASES: readonly RouteBenchmarkCase[] = [
  {
    id: 'margitsziget-run-flat',
    name: 'Margitsziget futókörnyezet',
    origin: { lat: 47.52988, lng: 19.05017 },
    activity: 'run',
    profile: 'walking',
    targetKm: 5,
    bearingDeg: 0,
    character: 'twisty',
    terrain: 'flat',
    junctions: 'simple',
  },
  {
    id: 'varosliget-walk-flat',
    name: 'Városliget gyalogos környezet',
    origin: { lat: 47.51479, lng: 19.08302 },
    activity: 'walk',
    profile: 'walking',
    targetKm: 4,
    bearingDeg: 90,
    character: 'twisty',
    terrain: 'flat',
    junctions: 'complex',
  },
  {
    id: 'deak-run-straight',
    name: 'Deák tér belvárosi futás',
    origin: { lat: 47.49791, lng: 19.05402 },
    activity: 'run',
    profile: 'walking',
    targetKm: 7.5,
    bearingDeg: 90,
    character: 'straight',
    terrain: 'flat',
    junctions: 'complex',
  },
  {
    id: 'nepliget-run-flat',
    name: 'Népliget futókörnyezet',
    origin: { lat: 47.47536, lng: 19.09908 },
    activity: 'run',
    profile: 'walking',
    targetKm: 8,
    bearingDeg: 135,
    character: 'twisty',
    terrain: 'flat',
    junctions: 'simple',
  },
  {
    id: 'normafa-walk-hilly',
    name: 'Normafa dombos gyaloglás',
    origin: { lat: 47.50192, lng: 18.96569 },
    activity: 'walk',
    profile: 'walking',
    targetKm: 6,
    bearingDeg: 270,
    character: 'twisty',
    terrain: 'hilly',
    junctions: 'simple',
  },
  {
    id: 'gellert-run-hilly',
    name: 'Gellért tér dombos futás',
    origin: { lat: 47.48343, lng: 19.05491 },
    activity: 'run',
    profile: 'walking',
    targetKm: 7.5,
    bearingDeg: 270,
    character: 'straight',
    terrain: 'hilly',
    junctions: 'complex',
  },
  {
    id: 'huvosvolgy-run-hilly',
    name: 'Hűvösvölgy dombos futás',
    origin: { lat: 47.54155, lng: 18.96474 },
    activity: 'run',
    profile: 'walking',
    targetKm: 10,
    bearingDeg: 225,
    character: 'twisty',
    terrain: 'hilly',
    junctions: 'complex',
  },
  {
    id: 'bikas-walk-flat',
    name: 'Bikás park gyalogos környezet',
    origin: { lat: 47.46555, lng: 19.03319 },
    activity: 'walk',
    profile: 'walking',
    targetKm: 5,
    bearingDeg: 180,
    character: 'twisty',
    terrain: 'flat',
    junctions: 'simple',
  },
  {
    id: 'margit-hid-bike-flat',
    name: 'Margit híd kerékpáros csomópont',
    origin: { lat: 47.51493, lng: 19.03964 },
    activity: 'bike',
    profile: 'cycling',
    targetKm: 20,
    bearingDeg: 0,
    character: 'straight',
    terrain: 'flat',
    junctions: 'complex',
  },
  {
    id: 'kelenfold-bike-hilly',
    name: 'Kelenföld dombos kerékpár',
    origin: { lat: 47.46431, lng: 19.02254 },
    activity: 'bike',
    profile: 'cycling',
    targetKm: 25,
    bearingDeg: 270,
    character: 'twisty',
    terrain: 'hilly',
    junctions: 'complex',
  },
  {
    id: 'obuda-bike-hilly',
    name: 'Óbuda kerékpáros környezet',
    origin: { lat: 47.54172, lng: 19.04131 },
    activity: 'bike',
    profile: 'cycling',
    targetKm: 20,
    bearingDeg: 315,
    character: 'twisty',
    terrain: 'hilly',
    junctions: 'complex',
  },
  {
    id: 'rakos-patak-bike-flat',
    name: 'Rákos-patak sík kerékpár',
    origin: { lat: 47.53105, lng: 19.10312 },
    activity: 'bike',
    profile: 'cycling',
    targetKm: 25,
    bearingDeg: 90,
    character: 'straight',
    terrain: 'flat',
    junctions: 'simple',
  },
] as const;
