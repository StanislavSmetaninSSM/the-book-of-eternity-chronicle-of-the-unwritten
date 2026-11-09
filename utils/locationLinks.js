// Coordinates identify a location only as a legacy fallback when they select one target.
// Legacy coordinate-only data without z belongs to the z = 0 layer.
export const coordinateZ = coordinates => coordinates?.z === undefined ? 0 : coordinates.z;

export const coordinateKey = coordinates => {
  if (!coordinates || !Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y)) return null;
  const z = coordinateZ(coordinates);
  return Number.isInteger(z) ? `${coordinates.x},${coordinates.y},${z}` : null;
};

export const normalizeCoordinates = coordinates => {
  const key = coordinateKey(coordinates);
  return key === null ? null : { x: coordinates.x, y: coordinates.y, z: coordinateZ(coordinates) };
};

export const sameHorizontalCoordinates = (left, right) =>
  !!left && !!right && Number.isFinite(left.x) && Number.isFinite(left.y) &&
  left.x === right.x && left.y === right.y;

export function resolveLinkTarget(link, locations) {
  if (link?.targetLocationId) return locations.find(l => l.locationId === link.targetLocationId) || null;
  const key = coordinateKey(link?.targetCoordinates);
  if (key === null) return null;
  const matches = locations.filter(l => coordinateKey(l.coordinates) === key);
  return matches.length === 1 ? matches[0] : null;
}

export function isAmbiguousCoordinateLink(link, locations) {
  if (link?.targetLocationId) return false;
  const key = coordinateKey(link?.targetCoordinates);
  return key === null || locations.filter(l => coordinateKey(l.coordinates) === key).length > 1;
}

export function matchingLinkIndexes(links, query, locations) {
  if (!query || isAmbiguousCoordinateLink(query, locations)) return [];
  if (query.targetLocationId) {
    const exact = links.map((link, i) => link?.targetLocationId === query.targetLocationId ? i : -1).filter(i => i >= 0);
    if (exact.length) return exact;
    // An ID may address a legacy link only if its coordinates resolve uniquely to that ID.
    return links.map((link, i) => link && !link.targetLocationId && resolveLinkTarget(link, locations)?.locationId === query.targetLocationId ? i : -1).filter(i => i >= 0);
  }
  const key = coordinateKey(query.targetCoordinates);
  return links.map((link, i) => coordinateKey(link?.targetCoordinates) === key ? i : -1).filter(i => i >= 0);
}
