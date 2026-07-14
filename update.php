<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Disable execution time limit for this script as fetching API can take time
set_time_limit(60);

$output = [];
$retval = null;

// Execute the python script and redirect stderr to stdout to catch errors
exec('python3 update_fuel.py --source web_button 2>&1', $output, $retval);

if ($retval === 0) {
    echo json_encode([
        'status' => 'success',
        'message' => 'Данные успешно обновлены с серверов API',
        'output' => $output
    ]);
} else {
    // If python3 is not found in PATH, try default absolute path
    $output = [];
    exec('/usr/bin/python3 update_fuel.py --source web_button 2>&1', $output, $retval);
    
    if ($retval === 0) {
        echo json_encode([
            'status' => 'success',
            'message' => 'Данные успешно обновлены с серверов API',
            'output' => $output
        ]);
    } else {
        http_response_code(500);
        echo json_encode([
            'status' => 'error',
            'message' => 'Не удалось запустить скрипт обновления',
            'details' => $output,
            'code' => $retval
        ]);
    }
}
?>
