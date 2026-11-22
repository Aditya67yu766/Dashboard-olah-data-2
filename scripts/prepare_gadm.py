import argparse
import io
import json
import zipfile
from pathlib import Path

import shapefile
from shapely.geometry import mapping, shape


PROVINCES = {
    "Bangka Belitung",
    "Bengkulu",
    "Lampung",
    "Sumatera Selatan",
}
FIELDS_BY_LEVEL = {
    1: ("GID_1", "NAME_1"),
    2: ("GID_1", "NAME_1", "GID_2", "NAME_2"),
    3: ("GID_1", "NAME_1", "GID_2", "NAME_2", "GID_3", "NAME_3"),
}


def convert_level(archive, level, output_dir):
    stem = f"gadm36_IDN_{level}"
    reader = shapefile.Reader(
        shp=io.BytesIO(archive.read(f"{stem}.shp")),
        shx=io.BytesIO(archive.read(f"{stem}.shx")),
        dbf=io.BytesIO(archive.read(f"{stem}.dbf")),
        encoding="utf-8",
    )
    fields = [field[0] for field in reader.fields[1:]]
    features = []

    for shape_record in reader.iterShapeRecords():
        properties = dict(zip(fields, shape_record.record))
        if properties.get("NAME_1") not in PROVINCES:
            continue

        geometry = shape(shape_record.shape.__geo_interface__)
        if not geometry.is_valid:
            raise ValueError(f"Invalid geometry in {stem}: {properties}")

        features.append({
            "type": "Feature",
            "properties": {
                field: properties[field]
                for field in FIELDS_BY_LEVEL[level]
            },
            "geometry": mapping(geometry),
        })

    if not features:
        raise ValueError(f"No selected province features found in {stem}.")

    collection = {
        "type": "FeatureCollection",
        "name": f"SI-BVET administrative boundaries level {level}",
        "source": "GADM version 3.4, April 2018; four-province subset",
        "admin_level": level,
        "features": features,
    }
    output = output_dir / f"gadm36-sumbagsel-{level}.geojson"
    output.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"{output.name}: {len(features)} features")


def main():
    parser = argparse.ArgumentParser(
        description="Extract four Sumbagsel provinces from the supplied GADM ZIP."
    )
    parser.add_argument("archive", type=Path, help="Path to gadm36_IDN_shp.zip")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data"),
        help="Output directory (default: public/data)",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.archive) as archive:
        for level in (1, 2, 3):
            convert_level(archive, level, args.output)


if __name__ == "__main__":
    main()
