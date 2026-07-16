import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
import concurrent.futures
from datetime import datetime, timezone

# Bounding boxes and parameters for cities
CITIES = {
    'kazan': {
        'lat': 55.761745,
        'lng': 49.18308,
        'radius': 25000
    },
    'spb': {
        'lat': 59.93863,
        'lng': 30.31413,
        'radius': 30000
    },
    'moscow': {
        'lat': 55.755826,
        'lng': 37.617299,
        'radius': 35000
    }
}

LIMIT = 200

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://2gis.ru/',
    'Origin': 'https://2gis.ru'
}

# Parse source argument
parser = argparse.ArgumentParser()
parser.add_argument("--source", type=str, default="manual", help="Trigger source (manual, scheduler, web_button)")
args = parser.parse_known_args()[0]

source = args.source
if source == "manual" and sys.platform.startswith('linux'):
    try:
        import getpass
        if getpass.getuser() != 'http':
            source = "scheduler"
    except Exception:
        pass

script_dir = os.path.dirname(os.path.abspath(__file__))
log_file = os.path.join(script_dir, 'update.log')
status_file = os.path.join(script_dir, 'status.json')

# Helper to log to file
def write_log(message):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = f"[{timestamp}] [Source: {source.upper()}] {message}\n"
    print(log_entry.strip())
    try:
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        try:
            os.chmod(log_file, 0o666)
        except Exception:
            pass
    except Exception as e:
        print(f"Failed to write to log file: {e}", file=sys.stderr)

def fetch_details_for_station(item):
    station_id = item.get('station', {}).get('id')
    if not station_id:
        return item
    url = f"https://benzin.api.2gis.ru/api/v1/stations/{station_id}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            details = json.loads(response.read().decode('utf-8'))
            item['recent_reports'] = details.get('recent_reports', [])
    except Exception:
        item['recent_reports'] = []
    return item

def is_valid_azs(name):
    name_lower = name.lower()
    # If it explicitly says AZS, AGZS, or Zapravka, it's valid
    if any(x in name_lower for x in ['азс', 'агзс', 'заправка']):
        return True
    # If it contains non-azs keywords, filter it out
    non_azs_keywords = ['техосмотр', 'мойка', 'автосервис', 'шиномонтаж', 'детейлинг', 'зарядная станция', 'электрозаправка', 'сто ', 'зарядка']
    if any(k in name_lower for k in non_azs_keywords):
        return False
    return True

results = []

for city, coords in CITIES.items():
    count_2gis = 0
    count_gdebenz = 0
    status_2gis = "failed"
    status_gdebenz = "failed"
    
    output_2gis = os.path.join(script_dir, f'data_2gis_{city}.json')
    output_gdebenz = os.path.join(script_dir, f'data_gdebenz_{city}.json')
    
    # 1. Fetch 2GIS
    url_2gis = f"https://benzin.api.2gis.ru/api/v1/stations/nearby?lat={coords['lat']}&lng={coords['lng']}&radius={coords['radius']}&limit={LIMIT}"
    try:
        req = urllib.request.Request(url_2gis, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            stations = json.loads(response.read().decode('utf-8'))
            stations = [s for s in stations if is_valid_azs(s.get('station', {}).get('name', ''))]
            
        # Concurrently fetch details for all stations to get recent_reports
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            stations = list(executor.map(fetch_details_for_station, stations))
            
        count_2gis = len(stations)
        with open(output_2gis, 'w', encoding='utf-8') as f:
            json.dump(stations, f, indent=2, ensure_ascii=False)
        try:
            os.chmod(output_2gis, 0o666)
        except Exception:
            pass
        status_2gis = "success"
    except Exception as e:
        status_2gis = f"error ({e})"
        
    # 2. Fetch GdeBenz
    url_gdebenz = f"https://gdebenz.org/api/nearby?lat={coords['lat']}&lon={coords['lng']}&radius_km={int(coords['radius'] // 1000)}"
    gdebenz_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
    }
    try:
        import gzip
        import io
        req = urllib.request.Request(url_gdebenz, headers=gdebenz_headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            content = response.read()
            if response.info().get('Content-Encoding') == 'gzip':
                buf = io.BytesIO(content)
                gf = gzip.GzipFile(fileobj=buf)
                content = gf.read()
            res = json.loads(content.decode('utf-8'))
            stations = res.get('stations', [])
            stations = [s for s in stations if is_valid_azs(s.get('name', ''))]
            count_gdebenz = len(stations)
        with open(output_gdebenz, 'w', encoding='utf-8') as f:
            json.dump(stations, f, indent=2, ensure_ascii=False)
        try:
            os.chmod(output_gdebenz, 0o666)
        except Exception:
            pass
        status_gdebenz = "success"
    except Exception as e:
        status_gdebenz = f"error ({e})"
        
    results.append(f"{city.upper()}: 2GIS {status_2gis} ({count_2gis} st) | GdeBenz {status_gdebenz} ({count_gdebenz} st)")

# Log summary
write_log(" | ".join(results))

# Save status.json with both auto and manual timestamps
try:
    status_data = {}
    if os.path.exists(status_file):
        try:
            with open(status_file, 'r', encoding='utf-8') as f:
                status_data = json.load(f)
        except Exception:
            pass
            
    now_str = datetime.now(timezone.utc).isoformat()
    if source == 'scheduler':
        status_data['last_scheduler_update'] = now_str
    else:
        status_data['last_manual_update'] = now_str
        
    with open(status_file, 'w', encoding='utf-8') as f:
        json.dump(status_data, f, indent=2, ensure_ascii=False)
    try:
        os.chmod(status_file, 0o666)
    except Exception:
        pass
except Exception as e:
    print(f"Failed to write status.json: {e}", file=sys.stderr)
