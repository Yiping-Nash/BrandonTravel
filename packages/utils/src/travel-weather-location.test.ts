import { describe, it, expect } from "vitest";
import { gcj02ToWgs84 } from "./travel-weather-location";
describe("天气坐标转换", () => {
  it("北京GCJ02近似反算WGS84", () => {
    const p = gcj02ToWgs84(116.404, 39.915);
    expect(p.longitude).toBeCloseTo(116.39775, 4);
    expect(p.latitude).toBeCloseTo(39.9136, 4);
  });
  it("境外保留坐标，不引入偏移", () => {
    expect(gcj02ToWgs84(-74, 40)).toEqual({ longitude: -74, latitude: 40 });
  });
  it("拒绝非法坐标", () => {
    expect(() => gcj02ToWgs84(NaN, 23)).toThrow();
    expect(() => gcj02ToWgs84(181, 23)).toThrow();
  });
});
