import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three/webgpu";
import { type DemoRenderer, forceWebGL, runDemo } from "./common/app.js";
import type { FlightFrame } from "./common/flight.js";
import { puffGeometry } from "./common/puff-geometry.js";

const MAX_PUFFS = 400;

class ThreeRenderer implements DemoRenderer {
  gl?: WebGL2RenderingContext;
  device?: GPUDevice;
  backend = "";

  private renderer!: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 200);
  private plane = new THREE.Group();
  private propeller?: THREE.Object3D;
  private puffs!: THREE.InstancedMesh;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    // WebGPU where available; three.js falls back to its WebGL2 backend on its own.
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      alpha: true,
      antialias: true,
      forceWebGL: forceWebGL(),
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    await this.renderer.init();
    const backend = this.renderer.backend as unknown as {
      isWebGPUBackend?: boolean;
      device?: GPUDevice;
      gl?: WebGL2RenderingContext;
    };
    if (backend.isWebGPUBackend) {
      this.device = backend.device;
      this.backend = "WebGPU";
    } else {
      this.gl = backend.gl;
      this.backend = "WebGL2";
    }

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-1, 2, 1.5);
    this.scene.add(sun);

    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/airplane.glb`);
    this.plane.add(gltf.scene);
    this.propeller = gltf.scene.getObjectByName("propeller");
    this.plane.visible = false;
    this.scene.add(this.plane);

    const data = puffGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    const material = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2,
      roughness: 0.9,
      flatShading: true,
    });
    this.puffs = new THREE.InstancedMesh(geometry, material, MAX_PUFFS);
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.frustumCulled = false;
    this.puffs.count = 0;
    this.scene.add(this.puffs);
  }

  resize(width: number, height: number, fovY: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = THREE.MathUtils.radToDeg(fovY);
    this.camera.updateProjectionMatrix();
  }

  start(frame: (dtMs: number) => FlightFrame): void {
    const timer = new THREE.Timer();
    this.renderer.setAnimationLoop((t) => {
      timer.update(t);
      this.draw(frame(timer.getDelta() * 1000));
    });
  }

  private draw(f: FlightFrame): void {
    this.plane.visible = f.visible;
    this.plane.position.fromArray(f.position);
    this.plane.quaternion.fromArray(f.quaternion);
    this.plane.scale.setScalar(f.scale);
    if (this.propeller) this.propeller.rotation.z = f.propeller;

    const count = Math.min(f.puffCount, MAX_PUFFS);
    (this.puffs.instanceMatrix.array as Float32Array).set(f.puffMatrices.subarray(0, count * 16));
    this.puffs.instanceMatrix.needsUpdate = true;
    this.puffs.count = count;

    this.renderer.render(this.scene, this.camera);
  }
}

void runDemo(new ThreeRenderer());
