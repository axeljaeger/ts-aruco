import "@babylonjs/loaders/glTF";
import {
  type AbstractEngine,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  ImportMeshAsync,
  Mesh,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  VertexData,
  WebGPUEngine,
} from "@babylonjs/core";
import airplaneUrl from "./assets/airplane.glb?url";
import { type DemoRenderer, forceWebGL, runDemo } from "./common/app.js";
import type { FlightFrame } from "./common/flight.js";
import { puffGeometry } from "./common/puff-geometry.js";

const MAX_PUFFS = 400;
const PROP_AXIS = new Vector3(0, 0, 1);

class BabylonRenderer implements DemoRenderer {
  device: GPUDevice | undefined;
  gl: WebGL2RenderingContext | undefined;
  backend = "";

  private engine!: AbstractEngine;
  private scene!: Scene;
  private camera!: UniversalCamera;
  private plane!: TransformNode;
  private propeller: TransformNode | undefined;
  private puffs!: Mesh;
  private readonly puffBuffer = new Float32Array(16 * MAX_PUFFS);

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!forceWebGL() && (await WebGPUEngine.IsSupportedAsync)) {
      const engine = new WebGPUEngine(canvas, { antialias: true, premultipliedAlpha: true });
      await engine.initAsync();
      this.engine = engine;
      this.backend = "WebGPU";
      // Babylon keeps its GPUDevice internal; sharing it saves a second device on the same adapter.
      this.device = (engine as unknown as { _device?: GPUDevice })._device;
    } else {
      // No WebGPU: Babylon's WebGL2 engine, whose context the WebGL2 preprocessor can share.
      const engine = new Engine(canvas, true, { premultipliedAlpha: true, alpha: true });
      this.engine = engine;
      this.backend = "WebGL2";
      this.gl = engine._gl as WebGL2RenderingContext;
    }

    const scene = new Scene(this.engine);
    this.scene = scene;
    // Same camera frame as POSIT's poses (and three.js): right-handed, looking down -z.
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0, 0, 0, 0);

    this.camera = new UniversalCamera("camera", Vector3.Zero(), scene);
    this.camera.setTarget(new Vector3(0, 0, -1));
    this.camera.minZ = 0.05;
    this.camera.maxZ = 200;

    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.9;
    hemi.groundColor = new Color3(0.3, 0.35, 0.4);
    const sun = new DirectionalLight("sun", new Vector3(1, -2, -1.5), scene);
    sun.intensity = 1.6;

    this.plane = new TransformNode("plane", scene);
    this.plane.rotationQuaternion = Quaternion.Identity();
    const result = await ImportMeshAsync(airplaneUrl, scene);
    for (const mesh of result.meshes) {
      if (!mesh.parent) mesh.parent = this.plane;
    }
    this.propeller =
      result.transformNodes.find((n) => n.name === "propeller") ??
      result.meshes.find((m) => m.name === "propeller");
    this.plane.setEnabled(false);

    const data = puffGeometry();
    this.puffs = new Mesh("puffs", scene);
    const vd = new VertexData();
    vd.positions = data.positions;
    vd.normals = data.normals;
    vd.indices = data.indices;
    vd.applyToMesh(this.puffs);
    const mat = new StandardMaterial("smoke", scene);
    mat.diffuseColor = new Color3(0.95, 0.95, 0.95);
    mat.emissiveColor = new Color3(0.25, 0.25, 0.25);
    mat.specularColor = Color3.Black();
    this.puffs.material = mat;
    this.puffs.thinInstanceSetBuffer("matrix", this.puffBuffer, 16, false);
    this.puffs.thinInstanceCount = 0;
    this.puffs.alwaysSelectAsActiveMesh = true;
  }

  resize(width: number, height: number, fovY: number): void {
    const canvas = this.engine.getRenderingCanvas()!;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this.engine.setSize(
      Math.round(width * Math.min(window.devicePixelRatio, 2)),
      Math.round(height * Math.min(window.devicePixelRatio, 2)),
    );
    this.camera.fov = fovY;
  }

  start(frame: (dtMs: number) => FlightFrame): void {
    this.engine.runRenderLoop(() => {
      const f = frame(this.engine.getDeltaTime());
      this.plane.setEnabled(f.visible);
      this.plane.position.set(f.position[0], f.position[1], f.position[2]);
      this.plane.rotationQuaternion!.set(
        f.quaternion[0],
        f.quaternion[1],
        f.quaternion[2],
        f.quaternion[3],
      );
      this.plane.scaling.setAll(f.scale);
      if (this.propeller) {
        this.propeller.rotationQuaternion = Quaternion.RotationAxis(PROP_AXIS, f.propeller);
      }

      const count = Math.min(f.puffCount, MAX_PUFFS);
      this.puffBuffer.set(f.puffMatrices.subarray(0, count * 16));
      this.puffs.thinInstanceBufferUpdated("matrix");
      this.puffs.thinInstanceCount = count;
      // With 0 thin instances Babylon draws the mesh itself once, with an identity matrix: a
      // puff of radius 1 around the camera, of which a few triangles show up. Hide it instead.
      this.puffs.setEnabled(count > 0);

      this.scene.render();
    });
  }
}

void runDemo(new BabylonRenderer());
