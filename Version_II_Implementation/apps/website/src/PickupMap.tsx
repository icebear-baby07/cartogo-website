import { useEffect, useRef } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import type { SiteAsset } from "@cartogo/contracts";
import "maplibre-gl/dist/maplibre-gl.css";

type PickupLocation = Extract<SiteAsset, { asset_type: "location" }>;

export default function PickupMap({ locations }: { locations: PickupLocation[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mapContainer.current;
    if (!container || !locations.length) return;

    const bounds = new LngLatBounds();
    for (const location of locations) {
      bounds.extend([location.coordinates.lng, location.coordinates.lat]);
    }
    const center = bounds.getCenter();
    const map = new MapLibreMap({
      container,
      style: {
        version: 8,
        sources: {
          openstreetmap: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors",
          },
        },
        layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }],
      },
      center: [center.lng, center.lat],
      zoom: locations.length === 1 ? 12 : 9,
      maxZoom: 18,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    for (const location of locations) {
      const popupContent = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = location.loc_name || location.display_name;
      const detail = document.createElement("p");
      detail.textContent = `${location.display_name}${location.status === "closed" ? " · Currently closed" : ""}`;
      popupContent.append(heading, detail);
      new Marker({ color: "#d62828" })
        .setLngLat([location.coordinates.lng, location.coordinates.lat])
        .setPopup(new Popup({ offset: 24 }).setDOMContent(popupContent))
        .addTo(map);
    }
    if (locations.length > 1) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 0 });
    }
    return () => map.remove();
  }, [locations]);

  return (
    <div
      className="pickup-map"
      ref={mapContainer}
      role="img"
      aria-label={`Map showing ${locations.length} pickup ${locations.length === 1 ? "location" : "locations"}`}
    />
  );
}
