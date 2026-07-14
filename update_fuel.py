import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
from datetime import datetime, timezone

# Bounding boxes and parameters for cities
CITIES = {
    'kazan': {
        'lat': 55.761745,
        'lng': 49.18308,
        'radius': 25000,
        'min_lat': 55.761745 - 0.18,
        'max_lat': 55.761745 + 0.18,
        'min_lon': 49.18308 - 0.28,
        'max_lon': 49.18308 + 0.28
    },
    'spb': {
        'lat': 59.93863,
        'lng': 30.31413,
        'radius': 30000,
        'min_lat': 59.93863 - 0.25,
        'max_lat': 59.93863 + 0.25,
        'min_lon': 30.31413 - 0.45,
        'max_lon': 30.31413 + 0.45
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

results = []

for city, coords in CITIES.items():
    count_2gis = 0
    count_tbank = 0
    status_2gis = "failed"
    status_tbank = "failed"
    
    output_2gis = os.path.join(script_dir, f'data_2gis_{city}.json')
    output_tbank = os.path.join(script_dir, f'data_tbank_{city}.json')
    
    # 1. Fetch 2GIS
    url_2gis = f"https://benzin.api.2gis.ru/api/v1/stations/nearby?lat={coords['lat']}&lng={coords['lng']}&radius={coords['radius']}&limit={LIMIT}"
    try:
        req = urllib.request.Request(url_2gis, headers=headers)
        with urllib.request.urlopen(req) as response:
            stations = json.loads(response.read().decode('utf-8'))
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
        
    # 2. Fetch T-Bank
    tbank_params = {
        "minLat": round(coords['min_lat'], 4),
        "maxLat": round(coords['max_lat'], 4),
        "minLon": round(coords['min_lon'], 4),
        "maxLon": round(coords['max_lon'], 4)
    }
    url_tbank = "https://toplivo.tbank.ru/api/v1/stations?" + urllib.parse.urlencode(tbank_params)
    tbank_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://toplivo.tbank.ru/',
        'Origin': 'https://toplivo.tbank.ru'
    }
    try:
        req = urllib.request.Request(url_tbank, headers=tbank_headers)
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read().decode('utf-8'))
            stations = res.get('payload', [])
            count_tbank = len(stations)
        with open(output_tbank, 'w', encoding='utf-8') as f:
            json.dump(stations, f, indent=2, ensure_ascii=False)
        try:
            os.chmod(output_tbank, 0o666)
        except Exception:
            pass
        status_tbank = "success"
    except Exception as e:
        status_tbank = f"error ({e})"
        
    results.append(f"{city.upper()}: 2GIS {status_2gis} ({count_2gis} st) | T-Bank {status_tbank} ({count_tbank} st)")

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
