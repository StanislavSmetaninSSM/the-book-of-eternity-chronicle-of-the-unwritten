// Coordinates are only a legacy fallback when they identify at most one location.
export const coordinateKey = c => c && Number.isFinite(c.x) && Number.isFinite(c.y) ? `${c.x},${c.y}` : null;
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
