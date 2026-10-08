// Approximate linear-sRGB colour of a blackbody at temperature T (Kelvin),
// normalised so the brightest channel is 1. Based on Tanner Helland's fit,
// converted from display sRGB to linear for use in an HDR pipeline.
export function blackbodyRGB(kelvin, out = [0, 0, 0]) {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  let r;
  let g;
  let b;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  const toLinear = (c) => {
    const v = Math.min(Math.max(c, 0), 255) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  r = toLinear(r);
  g = toLinear(g);
  b = toLinear(b);
  const m = Math.max(r, g, b, 1e-6);
  out[0] = r / m;
  out[1] = g / m;
  out[2] = b / m;
  return out;
}
