<?php
require __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const DATA_DIR = __DIR__ . '/data';

// ------------------------------------------------------------ helpers
function out($payload, $status = 200) {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function read_json($name, $default) {
    $path = DATA_DIR . '/' . $name;
    if (!file_exists($path)) return $default;
    $d = json_decode(file_get_contents($path), true);
    return $d === null ? $default : $d;
}
function write_json($name, $payload) {
    if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0755, true);
    $tmp = DATA_DIR . '/' . $name . '.tmp';
    file_put_contents($tmp, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    rename($tmp, DATA_DIR . '/' . $name);
}
function body_json() {
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 8000000) out(['error' => 'Request too large'], 400);
    if ($raw === '' || $raw === false) return [];
    $d = json_decode($raw, true);
    if ($d === null && trim($raw) !== 'null') out(['error' => 'Invalid JSON'], 400);
    return $d ?? [];
}
function admin_key() {
    if (!empty($_SERVER['HTTP_X_ADMIN_KEY'])) return $_SERVER['HTTP_X_ADMIN_KEY'];
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strtolower($k) === 'x-admin-key') return $v;
    }
    return '';
}
function require_admin() {
    if (!hash_equals((string)ADMIN_PASSWORD, (string)admin_key())) out(['error' => 'Unauthorized'], 401);
}
function new_id($len = 8) { return substr(bin2hex(random_bytes(8)), 0, $len); }
function http_call($url, $method = 'GET', $headers = [], $body = null, $timeout = 30) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($res === false) throw new Exception($err ?: 'Network error');
    if ($code >= 400) throw new Exception("HTTP $code: " . substr($res, 0, 300));
    return json_decode($res, true) ?: [];
}

// ------------------------------------------------------------ flights
function provider_name() {
    $p = strtolower(FLIGHT_PROVIDER);
    if (in_array($p, ['duffel', 'travelpayouts', 'demo'])) return $p;
    if (DUFFEL_ACCESS_TOKEN) return 'duffel';
    if (TRAVELPAYOUTS_TOKEN) return 'travelpayouts';
    return 'demo';
}
function iso_minutes($d) {
    if (!$d || !preg_match('/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/', $d, $m)) return null;
    return (int)($m[1] ?? 0) * 1440 + (int)($m[2] ?? 0) * 60 + (int)($m[3] ?? 0);
}
function search_duffel($q) {
    $slices = [['origin' => $q['from'], 'destination' => $q['to'], 'departure_date' => $q['date']]];
    if ($q['return']) $slices[] = ['origin' => $q['to'], 'destination' => $q['from'], 'departure_date' => $q['return']];
    $pax = [];
    for ($i = 0; $i < $q['adults']; $i++) $pax[] = ['type' => 'adult'];
    $body = json_encode(['data' => ['slices' => $slices, 'passengers' => $pax, 'cabin_class' => $q['cabin']]]);
    $payload = http_call(
        'https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000', 'POST',
        ['Authorization: Bearer ' . DUFFEL_ACCESS_TOKEN, 'Duffel-Version: v2', 'Content-Type: application/json', 'Accept: application/json'],
        $body, 40
    );
    $results = [];
    $offers = array_slice($payload['data']['offers'] ?? [], 0, 40);
    foreach ($offers as $offer) {
        $slice = $offer['slices'][0];
        $segs = $slice['segments'];
        $first = $segs[0];
        $last = $segs[count($segs) - 1];
        $carrier = $first['marketing_carrier'] ?? [];
        $results[] = [
            'id' => $offer['id'],
            'airline' => $offer['owner']['name'] ?? ($carrier['name'] ?? ''),
            'airlineCode' => $offer['owner']['iata_code'] ?? ($carrier['iata_code'] ?? ''),
            'flightNumber' => ($carrier['iata_code'] ?? '') . ($first['marketing_carrier_flight_number'] ?? ''),
            'from' => $first['origin']['iata_code'],
            'to' => $last['destination']['iata_code'],
            'departAt' => $first['departing_at'],
            'arriveAt' => $last['arriving_at'],
            'durationMin' => iso_minutes($slice['duration'] ?? null),
            'stops' => count($segs) - 1,
            'price' => (float)$offer['total_amount'],
            'currency' => $offer['total_currency'],
            'cabin' => $q['cabin'],
            'returnTrip' => count($offer['slices']) > 1,
            'bookingUrl' => null,
        ];
    }
    return $results;
}
function search_travelpayouts($q) {
    $params = [
        'origin' => $q['from'], 'destination' => $q['to'], 'departure_at' => $q['date'],
        'currency' => strtolower($q['currency'] ?: 'usd'), 'sorting' => 'price', 'direct' => 'false',
        'limit' => 30, 'one_way' => $q['return'] ? 'false' : 'true', 'token' => TRAVELPAYOUTS_TOKEN,
    ];
    if ($q['return']) $params['return_at'] = $q['return'];
    $payload = http_call('https://api.travelpayouts.com/aviasales/v3/prices_for_dates?' . http_build_query($params), 'GET', ['Accept: application/json']);
    $results = [];
    foreach ($payload['data'] ?? [] as $item) {
        $depart = $item['departure_at'] ?? '';
        $dur = $item['duration_to'] ?? ($item['duration'] ?? 0);
        $arrive = '';
        try { $arrive = (new DateTime($depart))->modify("+$dur minutes")->format('c'); } catch (Exception $e) {}
        $booking = null;
        if (!empty($item['link'])) {
            $booking = 'https://www.aviasales.com' . $item['link'];
            if (TRAVELPAYOUTS_MARKER) $booking .= (strpos($booking, '?') !== false ? '&' : '?') . 'marker=' . TRAVELPAYOUTS_MARKER;
        }
        $results[] = [
            'id' => 'tp-' . count($results),
            'airline' => $item['airline'] ?? '',
            'airlineCode' => $item['airline'] ?? '',
            'flightNumber' => ($item['airline'] ?? '') . ($item['flight_number'] ?? ''),
            'from' => $item['origin_airport'] ?? ($item['origin'] ?? ''),
            'to' => $item['destination_airport'] ?? ($item['destination'] ?? ''),
            'departAt' => $depart,
            'arriveAt' => $arrive,
            'durationMin' => $dur ?: null,
            'stops' => $item['transfers'] ?? 0,
            'price' => (float)($item['price'] ?? 0) * $q['adults'],
            'currency' => strtoupper($payload['currency'] ?? 'usd'),
            'cabin' => 'economy',
            'returnTrip' => (bool)$q['return'],
            'bookingUrl' => $booking,
        ];
    }
    return $results;
}
function search_demo($q) {
    $airlines = [['Emirates','EK'],['Qatar Airways','QR'],['Etihad Airways','EY'],['Turkish Airlines','TK'],['flydubai','FZ'],['Saudia','SV'],['PIA','PK'],['Air Arabia','G9'],['Lufthansa','LH'],['British Airways','BA'],['Singapore Airlines','SQ'],['Oman Air','WY']];
    mt_srand(crc32($q['from'] . $q['to'] . $q['date'] . $q['cabin']));
    $sum = 0;
    foreach (str_split($q['from'] . $q['to']) as $c) $sum += ord($c);
    $base = 180 + ($sum % 9) * 85;
    $mult = ['economy' => 1, 'premium_economy' => 1.7, 'business' => 3.4, 'first' => 5.5][$q['cabin']];
    $day = new DateTime($q['date']);
    for ($i = count($airlines) - 1; $i > 0; $i--) { $j = mt_rand(0, $i); $t = $airlines[$i]; $airlines[$i] = $airlines[$j]; $airlines[$j] = $t; }
    $mins = [0, 10, 25, 40, 55];
    $stopChoices = [0, 0, 1, 1, 2];
    $results = [];
    foreach (array_slice($airlines, 0, 8) as $i => $al) {
        $dep = (clone $day)->modify('+' . mt_rand(0, 22) . ' hours +' . $mins[mt_rand(0, 4)] . ' minutes');
        $stops = $stopChoices[mt_rand(0, 4)];
        $dur = mt_rand(150, 420) + $stops * mt_rand(70, 200);
        $price = ($base + mt_rand(-60, 260) - $stops * 35) * $mult * $q['adults'];
        if ($q['return']) $price *= 1.8;
        $arr = (clone $dep)->modify("+$dur minutes");
        $results[] = [
            'id' => "demo-$i", 'airline' => $al[0], 'airlineCode' => $al[1],
            'flightNumber' => $al[1] . mt_rand(100, 999),
            'from' => $q['from'], 'to' => $q['to'],
            'departAt' => $dep->format('Y-m-d\TH:i:s'), 'arriveAt' => $arr->format('Y-m-d\TH:i:s'),
            'durationMin' => $dur, 'stops' => $stops, 'price' => round(max($price, 79), 2),
            'currency' => 'USD', 'cabin' => $q['cabin'], 'returnTrip' => (bool)$q['return'], 'bookingUrl' => null,
        ];
    }
    return $results;
}
function search_flights() {
    $get = function ($k, $d = '') { return trim((string)($_GET[$k] ?? $d)); };
    $q = [
        'from' => strtoupper(substr($get('from'), 0, 3)),
        'to' => strtoupper(substr($get('to'), 0, 3)),
        'date' => $get('date'),
        'return' => $get('return'),
        'adults' => max(1, min(9, (int)($get('adults', '1') ?: 1))),
        'cabin' => strtolower($get('cabin', 'economy')),
        'currency' => $get('currency', 'usd'),
    ];
    if (!preg_match('/^[A-Z]{3}$/', $q['from']) || !preg_match('/^[A-Z]{3}$/', $q['to'])) out(['error' => 'Please choose valid departure and destination airports.'], 400);
    if ($q['from'] === $q['to']) out(['error' => 'Departure and destination must be different.'], 400);
    foreach (['date', 'return'] as $k) {
        if ($k === 'return' && $q[$k] === '') continue;
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $q[$k]) || !strtotime($q[$k])) out(['error' => 'Please choose a valid travel date.'], 400);
    }
    if (!in_array($q['cabin'], ['economy', 'premium_economy', 'business', 'first'])) $q['cabin'] = 'economy';

    $provider = provider_name();
    $started = microtime(true);
    $note = null;
    try {
        if ($provider === 'duffel') $results = search_duffel($q);
        elseif ($provider === 'travelpayouts') $results = search_travelpayouts($q);
        else $results = search_demo($q);
    } catch (Exception $e) {
        error_log("[flights] $provider failed: " . $e->getMessage());
        $note = "Live fares from $provider are unavailable right now; showing sample fares.";
        $provider = 'demo';
        $results = search_demo($q);
    }
    usort($results, function ($a, $b) { return $a['price'] <=> $b['price']; });
    out([
        'provider' => $provider, 'live' => $provider !== 'demo', 'note' => $note, 'query' => $q,
        'tookMs' => (int)((microtime(true) - $started) * 1000), 'results' => $results,
    ]);
}

// ------------------------------------------------------------ routing
$route = '/' . trim($_GET['route'] ?? '', '/');
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if ($route === '/packages') out(read_json('packages.json', []));
    if ($route === '/settings') out(read_json('settings.json', new stdClass));
    if ($route === '/airports') {
        $q = strtolower(trim($_GET['q'] ?? ''));
        $airports = read_json('airports.json', []);
        if ($q !== '') {
            $airports = array_values(array_filter($airports, function ($a) use ($q) {
                return strpos(strtolower($a['code']), $q) !== false || strpos(strtolower($a['city']), $q) !== false
                    || strpos(strtolower($a['name']), $q) !== false || strpos(strtolower($a['country']), $q) !== false;
            }));
            usort($airports, function ($a, $b) use ($q) {
                $ka = [strtolower($a['code']) !== $q, strpos(strtolower($a['city']), $q) !== 0];
                $kb = [strtolower($b['code']) !== $q, strpos(strtolower($b['city']), $q) !== 0];
                return $ka <=> $kb;
            });
        }
        out(array_slice($airports, 0, 12));
    }
    if ($route === '/flights') search_flights();
    if ($route === '/enquiries') { require_admin(); out(read_json('enquiries.json', [])); }
    if ($route === '/status') out(['flightProvider' => provider_name()]);
    out(['error' => 'Not found'], 404);
}

if ($method === 'POST') {
    $data = body_json();
    if ($route === '/admin/login') {
        if (hash_equals((string)ADMIN_PASSWORD, (string)($data['password'] ?? ''))) out(['ok' => true]);
        out(['error' => 'Wrong password'], 401);
    }
    if ($route === '/enquiries') {
        $list = read_json('enquiries.json', []);
        $clean = [];
        foreach ($data as $k => $v) {
            $clean[$k] = mb_substr(is_scalar($v) ? (string)$v : json_encode($v, JSON_UNESCAPED_UNICODE), 0, 1000);
        }
        $clean['id'] = new_id(10);
        $clean['createdAt'] = date('Y-m-d\TH:i:s');
        array_unshift($list, $clean);
        write_json('enquiries.json', array_slice($list, 0, 2000));
        out(['ok' => true]);
    }
    if ($route === '/packages') {
        require_admin();
        $packages = read_json('packages.json', []);
        $data['id'] = !empty($data['id']) ? $data['id'] : new_id(8);
        $packages[] = $data;
        write_json('packages.json', $packages);
        out($data, 201);
    }
    out(['error' => 'Not found'], 404);
}

if ($method === 'PUT') {
    require_admin();
    $data = body_json();
    if ($route === '/settings') { write_json('settings.json', $data); out($data); }
    if ($route === '/packages') {
        if (!is_array($data) || (count($data) && array_keys($data) !== range(0, count($data) - 1))) out(['error' => 'Expected a list'], 400);
        write_json('packages.json', $data);
        out($data);
    }
    if (preg_match('#^/packages/([\w-]+)$#', $route, $m)) {
        $packages = read_json('packages.json', []);
        foreach ($packages as $i => $p) {
            if (($p['id'] ?? null) === $m[1]) {
                $data['id'] = $p['id'];
                $packages[$i] = $data;
                write_json('packages.json', $packages);
                out($data);
            }
        }
        out(['error' => 'Package not found'], 404);
    }
    out(['error' => 'Not found'], 404);
}

if ($method === 'DELETE') {
    require_admin();
    if (preg_match('#^/packages/([\w-]+)$#', $route, $m)) {
        $packages = read_json('packages.json', []);
        $rest = array_values(array_filter($packages, function ($p) use ($m) { return ($p['id'] ?? null) !== $m[1]; }));
        write_json('packages.json', $rest);
        out(['ok' => true, 'deleted' => count($packages) - count($rest)]);
    }
    if (preg_match('#^/enquiries/([\w-]+)$#', $route, $m)) {
        $rest = array_values(array_filter(read_json('enquiries.json', []), function ($e) use ($m) { return ($e['id'] ?? null) !== $m[1]; }));
        write_json('enquiries.json', $rest);
        out(['ok' => true]);
    }
    out(['error' => 'Not found'], 404);
}

out(['error' => 'Method not allowed'], 405);
