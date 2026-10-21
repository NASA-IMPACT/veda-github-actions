# Thumbnail credits

Every image in the first table is **NASA-produced imagery**, which carries no rights restrictions
(<https://www.nasa.gov/nasa-brand-center/images-and-media/>). Each was downloaded from the source
URL below, centre-cropped to 3:2, resized to **600 × 400** and palette-quantized to keep every file
**under 150 KB** (the catalog renders them as small cards, so full resolution is wasted bytes).

Two sources are used:

- **NASA Worldview / NASA Earthdata GIBS snapshot API** (`wvs.earthdata.nasa.gov/api/v1/snapshot`) —
  live NASA imagery services. The URLs below are reproducible: re-running one returns the same scene.
- **NASA Image and Video Library** (`images-assets.nasa.gov`, the asset host for
  <https://images.nasa.gov>) — NASA/JPL-Caltech and NASA/JSC archive imagery.

`fallback.png` is what the UI shows for an algorithm with no thumbnail of its own. It is real
imagery, not a generated placeholder — **no file in this folder is a placeholder**; every download
succeeded.

| File | What it actually is | Source URL | Credit |
|---|---|---|---|
| `landsat.png` | HLS L30 (Harmonized Landsat, from Landsat 8/9 OLI) true colour over Houston, TX — 2023-08-21 | `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=2023-08-21&BBOX=29.5,-95.8,30.3,-95.0&CRS=EPSG:4326&LAYERS=HLS_L30_Nadir_BRDF_Adjusted_Reflectance&FORMAT=image/jpeg&WIDTH=900&HEIGHT=600` | NASA Worldview / NASA Earthdata GIBS — HLS L30 (Landsat 8/9 OLI), NASA/USGS |
| `sentinel2.png` | HLS S30 (Harmonized Sentinel-2, from Sentinel-2 MSI) true colour over San Francisco Bay — 2023-08-12 | `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=2023-08-12&BBOX=37.5,-122.6,38.1,-121.9&CRS=EPSG:4326&LAYERS=HLS_S30_Nadir_BRDF_Adjusted_Reflectance&FORMAT=image/jpeg&WIDTH=900&HEIGHT=600` | NASA Worldview / NASA Earthdata GIBS — HLS S30, a NASA product derived from Copernicus Sentinel-2 data (© ESA/Copernicus) |
| `satellogic.png` | Astronaut photograph of a city, Crew Earth Observations, ISS Expedition 8 (`iss008e13212`) — stands in for commercial sub-metre optical, for which there is no NASA equivalent | `https://images-assets.nasa.gov/image/iss008e13212/iss008e13212~medium.jpg` | NASA Johnson Space Center — Image Science & Analysis Laboratory, Crew Earth Observations |
| `umbra.png` | "Space Radar Image of Los Angeles, California" (`PIA01789`) — SIR-C/X-SAR aboard Space Shuttle Endeavour | `https://images-assets.nasa.gov/image/PIA01789/PIA01789~medium.jpg` | NASA/JPL-Caltech |
| `capella.png` | "Space Radar Image of West Texas — SAR Scan" (`PIA01787`), centre-cropped past the archive matting | `https://images-assets.nasa.gov/image/PIA01787/PIA01787~medium.jpg` | NASA/JPL-Caltech |
| `iceye.png` | "Space Radar Image of North Atlantic Ocean" (`PIA01799`) — SAR over water, matching ICEYE's flood/maritime use | `https://images-assets.nasa.gov/image/PIA01799/PIA01799~medium.jpg` | NASA/JPL-Caltech |
| `blackmarble.png` | VIIRS Day/Night Band at-sensor radiance, **Suomi NPP**, eastern United States — 2025-01-09 | `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=2025-01-09&BBOX=24,-100,44,-70&CRS=EPSG:4326&LAYERS=VIIRS_SNPP_DayNightBand_At_Sensor_Radiance&FORMAT=image/jpeg&WIDTH=900&HEIGHT=600` | NASA Worldview / NASA Earthdata GIBS — VIIRS DNB, Suomi NPP |
| `blackmarble_noaa.png` | VIIRS Day/Night Band at-sensor radiance, **NOAA-20**, same scene and date — the NOAA-20 counterpart | `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=2025-01-09&BBOX=24,-100,44,-70&CRS=EPSG:4326&LAYERS=VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance&FORMAT=image/jpeg&WIDTH=900&HEIGHT=600` | NASA Worldview / NASA Earthdata GIBS — VIIRS DNB, NOAA-20 (JPSS-1) |
| `fallback.png` | Blue Marble shaded relief + bathymetry, Americas — the generic card for any algorithm without its own thumbnail | `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=2024-01-01&BBOX=-56,-170,72,10&CRS=EPSG:4326&LAYERS=BlueMarble_ShadedRelief_Bathymetry&FORMAT=image/jpeg&WIDTH=900&HEIGHT=600` | NASA Earth Observatory — Blue Marble: Next Generation, via NASA Worldview / GIBS |

### Products with no algorithm yet (`status: "external"`)

These algorithms list Disasters Portal products that no algorithm in this catalog makes yet. Each
thumbnail is that product's own **NASA Disasters Portal data-gallery card image** (the portal repo's
`public/img/data/<file>.webp`, shown at `https://science.data.nasa.gov/disasters/data-gallery/<id>`),
scaled to cover 600 × 400 and centre-cropped with macOS `sips`, then palette-quantized (≤ 150 KB).

| File | Portal card image | Credit |
|---|---|---|
| `opera.png` | `opera-rtc-rgb-mosaic.webp` — OPERA RTC RGB Mosaic | NASA Disasters Portal; NASA JPL OPERA; contains modified Copernicus Sentinel data (ESA) |
| `uavsar.png` | `uavsar-rgb.webp` — UAVSAR Polarimetric False Color Imagery | NASA Disasters Portal; NASA/JPL-Caltech UAVSAR team |
| `aviris3.png` | `aviris-3-pca.webp` — AVIRIS-3 Principal Component Analysis (PCA) | NASA Disasters Portal; NASA/JPL-Caltech AVIRIS Science Team |
| `planet.png` | `planet-true-color.webp` — Planet True Color Imagery | NASA Disasters Portal; **Planet Labs PBC** via NASA CSDA (commercial imagery, not public domain) |
| `vantor.png` | `vantor-true-color.webp` — Vantor True Color | NASA Disasters Portal; **Vantor, formerly Maxar** (commercial imagery, not public domain) |
| `skysat.png` | `skysat-true-color.webp` — Planet SkySat True Color Imagery | NASA Disasters Portal; **Planet Labs PBC** via NASA CSDA (commercial imagery, not public domain) |
| `ecostress.png` | `ecostress-land-surface-temperature.webp` — ECOSTRESS Land Surface Temperature | NASA Disasters Portal; NASA/JPL-Caltech ECOSTRESS |
| `gpm_imerg.png` | `gpm-imerg-precipitation.webp` — GPM IMERG Accumulated Precipitation | NASA Disasters Portal; NASA GSFC GES DISC (IMERG V07, via Giovanni) |
| `hydrosar.png` | `hydrosar-s1-classifications.webp` — HydroSAR Sentinel-1 Water Extent Classifications | NASA Disasters Portal; ASF DAAC / UAF HydroSAR; contains modified Copernicus Sentinel data (ESA) |
| `nisar.png` | `nisar-gunw-displacement.webp` — NISAR GUNW Surface Displacement | NASA Disasters Portal; NASA/JPL-Caltech, ISRO, ASF DAAC |
| `gaia.png` | `gaia-building-exposure.webp` — Global Assessment of Infrastructure Assets (GAIA) | NASA Disasters Portal; ImageCat, Inc., NASA Disasters Program |
| `wb57_dynamite.png` | `wb57-dynamite.webp` — WB-57 DyNAMITE Airborne Imagery | NASA Disasters Portal; NASA Johnson Space Center |
| `blackmarble_composites.png` | `black-marble-blue-yellow.webp` — Black Marble Nighttime Blue/Yellow Composite | NASA Disasters Portal; NASA GSFC, LANCE, NOAA, U.S. Naval Research Laboratory |
| `s1_damage.png` | `sentinel-1-damage-assessment.webp` — Sentinel-1 Likely Damaged Areas | NASA Disasters Portal; C. Scher (CUNY) and J. Van Den Hoek (OSU); contains modified Copernicus Sentinel data (ESA) |
| `s1s2_burn.png` | `sentinel-1-sentinel-2-burn-severity.webp` — Sentinel-1 and Sentinel-2 Burn Severity | NASA Disasters Portal; NASA Ames Research Center; contains modified Copernicus Sentinel data (ESA) |
| `sentinel2_change.png` | `sentinel-2-dnbr.webp` — Sentinel-2 Differenced Normalized Burn Ratio (dNBR) | NASA Disasters Portal; NASA/GSFC, USGS; contains modified Copernicus Sentinel data (ESA) |

## Notes on honesty

- Unlike the rows above them, `planet.png`, `skysat.png` and `vantor.png` **are** commercial vendor
  imagery: the same image the Disasters Portal publishes on that product's card, credited to the
  vendor. They are not public domain.

- The **SAR** thumbnails are NASA/JPL shuttle-radar imagery, not imagery from Umbra, Capella or
  ICEYE — those are commercial vendors whose imagery is **not** public domain. The thumbnails
  illustrate the *modality*; the `thumbCredit` field in `data/algorithms.json` is what the UI shows.
- Likewise `satellogic.png` is a NASA astronaut photograph, not Satellogic imagery, for the same
  reason.
- `sentinel2.png` is a **NASA** HLS product; the underlying Sentinel-2 observation is Copernicus
  data (free and open, attribution requested), which is why the credit names ESA/Copernicus too.

## Regenerating

Sizes and crops were produced by a one-off Pillow script (fetch → centre-crop 3:2 → resize 600×400 →
adaptive-palette PNG, stepping the palette down until the file is ≤ 150 KB). Nothing in the app or
in CI regenerates these — they are committed binaries. To replace one, drop a new 600×400 PNG here
under the same name and add a row above; `scripts/validate_data.py` fails the build if an
algorithm's `thumb` has no file on disk.
