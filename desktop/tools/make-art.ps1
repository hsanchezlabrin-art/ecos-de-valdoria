# Genera el ícono y las imágenes del instalador con la estética del juego.
# Uso: powershell -ExecutionPolicy Bypass -File desktop\tools\make-art.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Force $out | Out-Null

$gold = [System.Drawing.Color]::FromArgb(217, 181, 106)
$goldDark = [System.Drawing.Color]::FromArgb(138, 109, 59)
$muted = [System.Drawing.Color]::FromArgb(163, 154, 134)
$parch = [System.Drawing.Color]::FromArgb(236, 223, 196)

function New-Canvas($w, $h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.InterpolationMode = 'HighQualityBicubic'
  return @($bmp, $g)
}

function Fill-Slate($g, $w, $h, $cx, $cy) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse(-$w * 0.6 + $cx, -$h * 0.6 + $cy, $w * 1.2, $h * 1.2)
  $g.Clear([System.Drawing.Color]::FromArgb(8, 9, 11))
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = [System.Drawing.Color]::FromArgb(38, 43, 52)
  $brush.SurroundColors = @([System.Drawing.Color]::FromArgb(8, 9, 11))
  $brush.CenterPoint = New-Object System.Drawing.PointF($cx, $cy)
  $g.FillRectangle($brush, 0, 0, $w, $h)
}

function Draw-Emblem($g, $cx, $cy, $r) {
  # Halo dorado
  $halo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $halo.AddEllipse($cx - $r * 1.5, $cy - $r * 1.5, $r * 3, $r * 3)
  $hb = New-Object System.Drawing.Drawing2D.PathGradientBrush($halo)
  $hb.CenterColor = [System.Drawing.Color]::FromArgb(70, 217, 181, 106)
  $hb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 217, 181, 106))
  $g.FillEllipse($hb, $cx - $r * 1.5, $cy - $r * 1.5, $r * 3, $r * 3)
  # Disco
  $disc = New-Object System.Drawing.Drawing2D.GraphicsPath
  $disc.AddEllipse($cx - $r, $cy - $r, $r * 2, $r * 2)
  $db = New-Object System.Drawing.Drawing2D.PathGradientBrush($disc)
  $db.CenterColor = [System.Drawing.Color]::FromArgb(48, 54, 64)
  $db.SurroundColors = @([System.Drawing.Color]::FromArgb(14, 16, 20))
  $db.CenterPoint = New-Object System.Drawing.PointF($cx, ($cy - $r * 0.3))
  $g.FillEllipse($db, $cx - $r, $cy - $r, $r * 2, $r * 2)
  # Anillos de bronce
  $g.DrawEllipse((New-Object System.Drawing.Pen($goldDark, [Math]::Max(1.5, $r * 0.035))), $cx - $r, $cy - $r, $r * 2, $r * 2)
  $r2 = $r * 1.12
  $g.DrawEllipse((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140, 138, 109, 59), [Math]::Max(1, $r * 0.02))), $cx - $r2, $cy - $r2, $r2 * 2, $r2 * 2)
  # Letra V
  $font = New-Object System.Drawing.Font('Georgia', [single]($r * 1.05), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'
  $sf.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF(($cx - $r), ($cy - $r + $r * 0.06), ($r * 2), ($r * 2))
  $tb = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(240, 214, 140), [System.Drawing.Color]::FromArgb(176, 134, 64), 90)
  $g.DrawString('V', $font, $tb, $rect, $sf)
}

function Save-Bmp24($bmp, $path) {
  $b24 = New-Object System.Drawing.Bitmap($bmp.Width, $bmp.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($b24)
  $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
  $g.Dispose()
  $b24.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $b24.Dispose()
}

# ---------- Ícono 512 px (PNG) ----------
$c = New-Canvas 512 512; $bmp = $c[0]; $g = $c[1]
$g.Clear([System.Drawing.Color]::Transparent)
Draw-Emblem $g 256 256 200
$g.Dispose()
$bmp.Save((Join-Path $out 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# ---------- icon.ico con 256, 48, 32 y 16 px (PNG embebido) ----------
$sizes = 256, 48, 32, 16
$pngs = foreach ($s in $sizes) {
  $sm = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $sg = [System.Drawing.Graphics]::FromImage($sm)
  $sg.InterpolationMode = 'HighQualityBicubic'
  $sg.DrawImage($bmp, 0, 0, $s, $s)
  $sg.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $sm.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $sm.Dispose()
  , $ms.ToArray()
}
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ico)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $dim = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'), $ico.ToArray())
$bmp.Dispose()

# ---------- Barra lateral del instalador 164x314 ----------
$c = New-Canvas 164 314; $bmp = $c[0]; $g = $c[1]
Fill-Slate $g 164 314 82 110
# Brasas
$rnd = New-Object System.Random 7
for ($i = 0; $i -lt 26; $i++) {
  $x = $rnd.Next(8, 156); $y = $rnd.Next(150, 306); $a = $rnd.Next(60, 200)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, 255, 160, 80))), $x, $y, 2.5, 2.5)
}
Draw-Emblem $g 82 96 40
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'
$g.DrawString('ECOS DE', (New-Object System.Drawing.Font('Georgia', 9, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)), (New-Object System.Drawing.SolidBrush($muted)), (New-Object System.Drawing.RectangleF(0, 162, 164, 14)), $sf)
$g.DrawString('VALDORIA', (New-Object System.Drawing.Font('Georgia', 21, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)), (New-Object System.Drawing.SolidBrush($gold)), (New-Object System.Drawing.RectangleF(0, 176, 164, 28)), $sf)
$g.DrawLine((New-Object System.Drawing.Pen($goldDark, 1)), 38, 212, 126, 212)
$g.DrawString("Siete tierras rodean`nla Aldea de Brezal", (New-Object System.Drawing.Font('Georgia', 10, [System.Drawing.FontStyle]::Italic, [System.Drawing.GraphicsUnit]::Pixel)), (New-Object System.Drawing.SolidBrush($parch)), (New-Object System.Drawing.RectangleF(0, 222, 164, 32)), $sf)
# Marco de bronce
$g.DrawRectangle((New-Object System.Drawing.Pen($goldDark, 1)), 4, 4, 155, 305)
$g.DrawRectangle((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 138, 109, 59), 1)), 7, 7, 149, 299)
$g.Dispose()
Save-Bmp24 $bmp (Join-Path $out 'installerSidebar.bmp')
$bmp.Dispose()

# ---------- Encabezado del instalador 150x57 ----------
$c = New-Canvas 150 57; $bmp = $c[0]; $g = $c[1]
Fill-Slate $g 150 57 30 28
Draw-Emblem $g 28 28 17
$g.DrawString('VALDORIA', (New-Object System.Drawing.Font('Georgia', 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)), (New-Object System.Drawing.SolidBrush($gold)), 52, 19)
$g.Dispose()
Save-Bmp24 $bmp (Join-Path $out 'installerHeader.bmp')
$bmp.Dispose()

# ---------- Fondo de la ventana del .dmg de macOS 600x380 ----------
$c = New-Canvas 600 380; $bmp = $c[0]; $g = $c[1]
Fill-Slate $g 600 380 300 150
$rnd = New-Object System.Random 11
for ($i = 0; $i -lt 40; $i++) {
  $x = $rnd.Next(10, 590); $y = $rnd.Next(240, 372); $a = $rnd.Next(50, 170)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, 255, 160, 80))), $x, $y, 2.5, 2.5)
}
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'
$g.DrawString('ECOS DE', (New-Object System.Drawing.Font('Georgia', 11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)), (New-Object System.Drawing.SolidBrush($muted)), (New-Object System.Drawing.RectangleF(0, 34, 600, 16)), $sf)
$g.DrawString('VALDORIA', (New-Object System.Drawing.Font('Georgia', 30, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)), (New-Object System.Drawing.SolidBrush($gold)), (New-Object System.Drawing.RectangleF(0, 50, 600, 40)), $sf)
$g.DrawString('Arrastra el juego a la carpeta Aplicaciones', (New-Object System.Drawing.Font('Georgia', 13, [System.Drawing.FontStyle]::Italic, [System.Drawing.GraphicsUnit]::Pixel)), (New-Object System.Drawing.SolidBrush($parch)), (New-Object System.Drawing.RectangleF(0, 300, 600, 20)), $sf)
# Flecha de bronce entre el ícono del juego (x=160) y Aplicaciones (x=440)
$pen = New-Object System.Drawing.Pen($gold, 3)
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::ArrowAnchor
$g.DrawLine($pen, 236, 200, 364, 200)
$g.DrawRectangle((New-Object System.Drawing.Pen($goldDark, 1)), 6, 6, 587, 367)
$g.Dispose()
$bmp.Save((Join-Path $out 'dmgBackground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Get-ChildItem $out | Select-Object Name, Length
