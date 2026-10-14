export type Overlay = object;
export type MapInstance = {
  add: (items: Overlay | Overlay[]) => void;
  remove: (items: Overlay[]) => void;
  addControl: (c: unknown) => void;
  setMapStyle: (style: string) => void;
  setLayers: (layers: unknown[]) => void;
  setFitView: (
    items?: Overlay[],
    immediately?: boolean,
    padding?: number[],
    maxZoom?: number,
  ) => void;
  setCenter: (position: number[]) => void;
  getZoom: () => number;
  setZoom: (zoom: number) => void;
  on: (name: string, cb: () => void) => void;
  off: (name: string, cb: () => void) => void;
  destroy: () => void;
};
export type AMapAPI = {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => MapInstance;
  Marker: new (options: Record<string, unknown>) => Overlay;
  Polyline: new (options: Record<string, unknown>) => Overlay;
  TileLayer: {
    new (): unknown;
    Satellite: new () => unknown;
    RoadNet: new () => unknown;
  };
  Scale: new () => unknown;
  ToolBar: new () => unknown;
};
type Loader = {
  load: (input: {
    key: string;
    version: string;
    plugins: string[];
  }) => Promise<AMapAPI>;
  reset?: () => void;
};
declare global {
  interface Window {
    AMapLoader?: Loader;
    _AMapSecurityConfig?: { serviceHost: string };
  }
}
export type MapConfig = { key: string; version: "2.0"; serviceHost: string };
let loaderPromise: Promise<Loader> | null = null;
export function officialLoader(): Promise<Loader> {
  if (window.AMapLoader) return Promise.resolve(window.AMapLoader);
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise<Loader>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://webapi.amap.com/loader.js";
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      loaderPromise = null;
      reject(Error("高德地图加载超时"));
    }, 12000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.AMapLoader) resolve(window.AMapLoader);
      else {
        loaderPromise = null;
        reject(Error("高德地图加载器不可用"));
      }
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      loaderPromise = null;
      reject(Error("高德地图网络加载失败"));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}
export async function loadAMap(config: MapConfig) {
  window._AMapSecurityConfig = {
    serviceHost: location.origin + config.serviceHost,
  };
  const loader = await officialLoader();
  try {
    return await loader.load({
      key: config.key,
      version: config.version,
      plugins: ["AMap.Scale", "AMap.ToolBar"],
    });
  } catch {
    loader.reset?.();
    throw Error("高德地图鉴权或SDK加载失败，请检查JS API配置");
  }
}
