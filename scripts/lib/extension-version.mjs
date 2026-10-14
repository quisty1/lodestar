export function isChromeExtensionVersion(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(value)) return false;
  const components = value.split('.');
  if (components.every((component) => component === '0')) return false;
  return components.every(
    (component) =>
      !(component.length > 1 && component.startsWith('0')) && Number(component) <= 65535,
  );
}
