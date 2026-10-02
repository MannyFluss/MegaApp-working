// GitHub project sites share an origin. Keep the Working site's browser data
// separate while retaining every existing Live/local storage name.
export function isWorkingSite(pathname = globalThis.location?.pathname || "") {
  return pathname === "/MegaApp-working" || pathname.startsWith("/MegaApp-working/");
}

export function storageName(name, pathname) {
  return isWorkingSite(pathname) ? `${name}.working` : name;
}
