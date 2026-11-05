import { sourceLinkUrl } from './source-link.js';
import * as THREE from 'three';
import type { Detection, Presence } from './replay-model.js';
import { ZONE_A_CORNERS } from '../shared/zone-a.js';
import { aisCoverageLabel } from './display-labels.js';
import { aisLegend, cameraFrustum, canvasSize, sceneMarks, scenePoint } from './zone-frame.js';

export type AisMark = { id: string; latitude: number; longitude: number; sourceUrl: string };
export type ZoneSceneState = {
  presence: Presence[];
  detections: Detection[];
  selectedDetectionId: string | null;
  ais: AisMark[];
  aisStatus: string;
  hour: string;
};

const MARK = {
  gfw: { color: '#ce713a', radius: 0.012, z: 0.1 },
  ais: { color: '#245ac3', radius: 0.018, z: 0.2 },
  glider: { color: '#5a327f', radius: 0.025, z: 0.3 },
} as const;

function clearGroup(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.LineLoop) {
      geometries.add(child.geometry);
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((material) => materials.add(material));
    }
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function span(className: string, text: string) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

export function mountZoneScene(root: HTMLElement) {
  root.className = 'zone-scene';
  root.replaceChildren();
  const canvasHost = document.createElement('div');
  canvasHost.setAttribute('role', 'img');
  const legend = document.createElement('p');
  const limits = document.createElement('p');
  limits.textContent = 'Dots are positions, not vessel tracks. GFW is delayed hourly presence; AIS is the latest received position per vessel in 30 minutes. Empty AIS coverage stays unknown and is not shown as zero ships. Every indexed glider position is shown; a ring marks the selected row. A glider position does not locate a whale.';
  const credit = document.createElement('p');
  credit.className = 'source-credit';
  function namedLink(label: string, url: string | undefined) {
    const sourceUrl = sourceLinkUrl(url);
    if (!sourceUrl) return document.createTextNode(label);
    const link = document.createElement('a');
    link.href = sourceUrl;
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    return link;
  }
  function paintCredit(urls: { gfw?: string; ais?: string; glider?: string }) {
    credit.replaceChildren(
      'Powered by ',
      namedLink('Global Fishing Watch', urls.gfw),
      '. AIS: ',
      namedLink('AISStream', urls.ais),
      '. Glider: ',
      namedLink('WHOI / Robots4Whales', urls.glider),
      '.',
    );
  }
  paintCredit({});
  root.append(canvasHost, legend, limits, credit);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ecf4f5');
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 5;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  canvasHost.appendChild(renderer.domElement);
  const shape = new THREE.Shape();
  ZONE_A_CORNERS.forEach(([longitude, latitude], index) => {
    const point = scenePoint(latitude, longitude);
    if (index === 0) shape.moveTo(point.x, point.y); else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  const polygon = new THREE.Group();
  polygon.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#c9e1e3', side: THREE.DoubleSide })));
  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ZONE_A_CORNERS.map(([longitude, latitude]) => {
      const point = scenePoint(latitude, longitude);
      return new THREE.Vector3(point.x, point.y, 0.01);
    })),
    new THREE.LineBasicMaterial({ color: '#285862' }),
  );
  polygon.add(border);
  scene.add(polygon);
  const marks = new THREE.Group();
  scene.add(marks);
  const fit = () => {
    const size = canvasSize(canvasHost.clientWidth);
    const frame = cameraFrustum(size.width, size.height);
    camera.left = frame.left;
    camera.right = frame.right;
    camera.top = frame.top;
    camera.bottom = frame.bottom;
    camera.updateProjectionMatrix();
    renderer.setSize(size.width, size.height);
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(() => fit());
  observer.observe(canvasHost);
  fit();

  function update(state: ZoneSceneState) {
    clearGroup(marks);
    const rows = sceneMarks({
      presence: state.presence, ais: state.ais, detections: state.detections, selectedDetectionId: state.selectedDetectionId,
    });
    for (const layer of ['gfw', 'ais', 'glider'] as const) {
      const layerRows = rows.filter((row) => row.layer === layer);
      if (layerRows.length === 0) continue;
      const style = MARK[layer];
      const geometry = new THREE.CircleGeometry(style.radius, 16);
      const material = new THREE.MeshBasicMaterial({ color: style.color, side: THREE.DoubleSide });
      for (const row of layerRows) {
        const mark = new THREE.Mesh(geometry, material);
        const point = scenePoint(row.latitude, row.longitude);
        mark.position.set(point.x, point.y, style.z);
        marks.add(mark);
        if (!row.selected) continue;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(style.radius + 0.008, style.radius + 0.016, 24),
          new THREE.MeshBasicMaterial({ color: style.color, side: THREE.DoubleSide }),
        );
        ring.position.set(point.x, point.y, style.z + 0.01);
        marks.add(ring);
      }
    }
    renderer.render(scene, camera);
    paintCredit({
      gfw: state.presence.find((row) => row.sourceUrl)?.sourceUrl,
      ais: state.ais.find((row) => row.sourceUrl)?.sourceUrl,
      glider: state.detections.find((row) => row.sourceUrl)?.sourceUrl,
    });
    const aisText = state.ais.length === 0
      ? `AIS ${aisCoverageLabel(state.aisStatus)}`
      : `${state.ais.length} latest AIS marks (${aisCoverageLabel(state.aisStatus)})`;
    canvasHost.setAttribute('aria-label', `Zone A polygon with ${state.presence.length} GFW marks for ${state.hour}, ${aisText}, and ${state.detections.length} indexed glider positions`);
    legend.replaceChildren(
      span('gfw-key', '●'),
      document.createTextNode(` GFW selected hour (${state.presence.length}) · `),
      span('ais-key', '●'),
      document.createTextNode(` ${aisLegend(state.ais.length, state.aisStatus)} · `),
      span('glider-key', '●'),
      document.createTextNode(` Indexed glider positions (${state.detections.length})`),
    );
  }

  function destroy() {
    observer.disconnect();
    clearGroup(marks);
    clearGroup(polygon);
    scene.remove(marks, polygon);
    renderer.forceContextLoss();
    renderer.dispose();
    root.replaceChildren();
  }

  return { update, destroy };
}
