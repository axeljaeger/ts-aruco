import {
  addToScene,
  createDirectionalLight,
  createEngine,
  createFreeCamera,
  createHemisphericLight,
  createMeshFromData,
  createSceneContext,
  createStandardMaterial,
  type FreeCamera,
  loadGltf,
  type Mesh,
  onBeforeRender,
  registerScene,
  type SceneNode,
  setMeshVisible,
  setThinInstances,
  startEngine,
} from "@babylonjs/lite";
import airplaneUrl from "./assets/airplane.glb?url";
import { type DemoRenderer, runDemo } from "./common/app.js";
import type { FlightFrame } from "./common/flight.js";
import { quatFromAxisAngle } from "./common/math.js";
import { puffGeometry } from "./common/puff-geometry.js";

// This page is bundled with the `babylon-lite-rh` resolve condition (see vite.config.ts), so
// Babylon Lite runs right-handed like POSIT's camera frame and three.js.

class LiteRenderer implements DemoRenderer {
  readonly backend = "WebGPU";

  private engine!: Awaited<ReturnType<typeof createEngine>>;
  private scene!: ReturnType<typeof createSceneContext>;
  private camera!: FreeCamera;
  private plane!: SceneNode;
  private propeller: SceneNode | undefined;
  private puffs!: Mesh;
  private visible = true;
  private puffsVisible = true;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!("gpu" in navigator)) {
      throw new Error("Babylon Lite needs WebGPU, which this browser does not offer");
    }
    this.engine = await createEngine(canvas, {
      alphaMode: "premultiplied",
      maxDevicePixelRatio: 2,
    });
    const scene = createSceneContext(this.engine);
    this.scene = scene;
    scene.clearColor = { r: 0, g: 0, b: 0, a: 0 };

    this.camera = createFreeCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    this.camera.nearPlane = 0.05;
    this.camera.farPlane = 200;
    scene.camera = this.camera;

    addToScene(scene, createHemisphericLight([0, 1, 0], 0.9));
    addToScene(scene, createDirectionalLight([1, -2, -1.5], 1.6));

    const asset = await loadGltf(this.engine, airplaneUrl);
    addToScene(scene, asset);
    const roots = asset.entities.filter(
      (e): e is SceneNode => "children" in e && !("parent" in e && e.parent),
    );
    this.plane = roots.find((n) => findNode(n, "airplane")) ?? roots[0];
    this.propeller = findNode(this.plane, "propeller");

    const data = puffGeometry();
    this.puffs = createMeshFromData(
      this.engine,
      "puffs",
      data.positions,
      data.normals,
      data.indices,
    );
    const mat = createStandardMaterial();
    mat.diffuseColor = [0.95, 0.95, 0.95];
    mat.emissiveColor = [0.25, 0.25, 0.25];
    mat.specularColor = [0, 0, 0];
    this.puffs.material = mat;
    setThinInstances(this.puffs, new Float32Array(16), 0);
    addToScene(scene, this.puffs);

    await registerScene(scene);
  }

  resize(width: number, height: number, fovY: number): void {
    // Lite sizes the swapchain from the canvas' CSS box every frame.
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this.camera.fov = fovY;
  }

  start(frame: (dtMs: number) => FlightFrame): void {
    onBeforeRender(this.scene, (dt) => {
      const f = frame(dt);
      if (f.visible !== this.visible) {
        setMeshVisible(this.plane, f.visible);
        this.visible = f.visible;
      }
      this.plane.position.set(f.position[0], f.position[1], f.position[2]);
      this.plane.rotationQuaternion.set(
        f.quaternion[0],
        f.quaternion[1],
        f.quaternion[2],
        f.quaternion[3],
      );
      this.plane.scaling.set(f.scale, f.scale, f.scale);
      if (this.propeller) {
        const q = quatFromAxisAngle([0, 0, 1], f.propeller);
        this.propeller.rotationQuaternion.set(q[0], q[1], q[2], q[3]);
      }
      setThinInstances(this.puffs, f.puffMatrices, f.puffCount);
      if (f.puffCount > 0 !== this.puffsVisible) {
        // Same as in the Babylon.js demo: never let the bare mesh render without instances.
        this.puffsVisible = f.puffCount > 0;
        setMeshVisible(this.puffs, this.puffsVisible);
      }
    });
    void startEngine(this.engine);
  }
}

function findNode(node: SceneNode, name: string): SceneNode | undefined {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findNode(child, name);
    if (found) return found;
  }
  return undefined;
}

void runDemo(new LiteRenderer());
