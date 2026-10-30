Add-Type -AssemblyName System.Drawing

$src = "C:\Users\DELL\Desktop\دياجنو اسيست\logo.jpg"
$dst = "C:\Users\DELL\Desktop\دياجنو اسيست\logo-transparent.png"

$bmp = New-Object System.Drawing.Bitmap($src)

$W = $bmp.Width
$H = $bmp.Height

function Get-BgColor {
    $corners = @(
        $bmp.GetPixel(0, 0),
        $bmp.GetPixel($W - 1, 0),
        $bmp.GetPixel(0, $H - 1),
        $bmp.GetPixel($W - 1, $H - 1)
    )
    $r = 0; $g = 0; $b = 0
    foreach ($c in $corners) {
        $r += $c.R; $g += $c.G; $b += $c.B
    }
    return [System.Drawing.Color]::FromArgb([int]($r / 4), [int]($g / 4), [int]($b / 4))
}

$bg = Get-BgColor
Write-Host "Background sample: R=$($bg.R) G=$($bg.G) B=$($bg.B)"

$tolerance = 45
$visited = New-Object 'bool[,]' $W, $H
$queue = New-Object System.Collections.Queue

for ($x = 0; $x -lt $W; $x++) {
    $queue.Enqueue(@($x, 0))
    $queue.Enqueue(@($x, $H - 1))
}
for ($y = 0; $y -lt $H; $y++) {
    $queue.Enqueue(@(0, $y))
    $queue.Enqueue(@($W - 1, $y))
}

while ($queue.Count -gt 0) {
    $p = $queue.Dequeue()
    $x = $p[0]; $y = $p[1]
    if ($x -lt 0 -or $x -ge $W -or $y -lt 0 -or $y -ge $H) { continue }
    if ($visited[$x, $y]) { continue }
    $visited[$x, $y] = $true

    $c = $bmp.GetPixel($x, $y)
    $dr = [Math]::Abs($c.R - $bg.R)
    $dg = [Math]::Abs($c.G - $bg.G)
    $db = [Math]::Abs($c.B - $bg.B)
    $dist = [Math]::Sqrt($dr * $dr + $dg * $dg + $db * $db)

    if ($dist -le $tolerance) {
        $queue.Enqueue(@($x + 1, $y))
        $queue.Enqueue(@($x - 1, $y))
        $queue.Enqueue(@($x, $y + 1))
        $queue.Enqueue(@($x, $y - 1))
    }
}

$grid = New-Object 'int[,]' $W, $H
for ($x = 0; $x -lt $W; $x++) {
    for ($y = 0; $y -lt $H; $y++) {
        if ($visited[$x, $y]) {
            $c = $bmp.GetPixel($x, $y)
            $grid[$x, $y] = ($c.R + $c.G + $c.B) / 3
        } else {
            $grid[$x, $y] = -1
        }
    }
}

$out = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

for ($x = 0; $x -lt $W; $x++) {
    for ($y = 0; $y -lt $H; $y++) {
        $c = $bmp.GetPixel($x, $y)
        if ($visited[$x, $y]) {
            $alpha = 0
            foreach ($nx in @($x - 1, $x + 1)) {
                if ($nx -ge 0 -and $nx -lt $W -and $grid[$nx, $y] -eq -1) { $alpha = 1 }
            }
            foreach ($ny in @($y - 1, $y + 1)) {
                if ($ny -ge 0 -and $ny -lt $H -and $grid[$x, $ny] -eq -1) { $alpha = 1 }
            }
            if ($alpha -eq 1) {
                $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(80, $c.R, $c.G, $c.B))
            } else {
                $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, $c.R, $c.G, $c.B))
            }
        } else {
            $out.SetPixel($x, $y, $c)
        }
    }
}

$out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$out.Dispose()

Write-Host "Saved: $dst"
Write-Host "PNG OK"