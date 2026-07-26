param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$jpgPath = Join-Path $ProjectRoot "public\app-icon.jpg"
$icoPath = Join-Path $ProjectRoot "public\app-icon.ico"
$launcherIcoPath = Join-Path $ProjectRoot "launchers\SmashDrumsEditor.ico"

if (-not (Test-Path $jpgPath)) {
  throw "Missing icon source: $jpgPath"
}

Add-Type @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class IconWriter
{
    public static void SavePngIcon(string imagePath, string iconPath, int[] sizes)
    {
        using (var source = Image.FromFile(imagePath))
        {
            var pngImages = new List<byte[]>();
            foreach (var size in sizes)
            {
                using (var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                {
                    bmp.SetResolution(96, 96);
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.Clear(Color.FromArgb(255, 0, 0, 0));
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.SmoothingMode = SmoothingMode.HighQuality;

                        var scale = Math.Max((double)size / source.Width, (double)size / source.Height);
                        var drawW = (int)Math.Round(source.Width * scale);
                        var drawH = (int)Math.Round(source.Height * scale);
                        var drawX = (size - drawW) / 2;
                        var drawY = (size - drawH) / 2;
                        g.DrawImage(source, drawX, drawY, drawW, drawH);
                    }

                    using (var ms = new MemoryStream())
                    {
                        bmp.Save(ms, ImageFormat.Png);
                        pngImages.Add(ms.ToArray());
                    }
                }
            }

            Directory.CreateDirectory(Path.GetDirectoryName(iconPath));
            using (var fs = new FileStream(iconPath, FileMode.Create, FileAccess.Write))
            using (var bw = new BinaryWriter(fs))
            {
                bw.Write((ushort)0);
                bw.Write((ushort)1);
                bw.Write((ushort)pngImages.Count);

                var offset = 6 + (16 * pngImages.Count);
                for (var i = 0; i < pngImages.Count; i++)
                {
                    var size = sizes[i];
                    var data = pngImages[i];
                    bw.Write((byte)(size >= 256 ? 0 : size));
                    bw.Write((byte)(size >= 256 ? 0 : size));
                    bw.Write((byte)0);
                    bw.Write((byte)0);
                    bw.Write((ushort)1);
                    bw.Write((ushort)32);
                    bw.Write((uint)data.Length);
                    bw.Write((uint)offset);
                    offset += data.Length;
                }

                foreach (var data in pngImages)
                {
                    bw.Write(data);
                }
            }
        }
    }
}
"@ -ReferencedAssemblies System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)
[IconWriter]::SavePngIcon($jpgPath, $icoPath, $sizes)
New-Item -ItemType Directory -Force -Path (Split-Path $launcherIcoPath -Parent) | Out-Null
Copy-Item -LiteralPath $icoPath -Destination $launcherIcoPath -Force

$bytes = (Get-Item $icoPath).Length
Write-Host "Created $icoPath ($bytes bytes)"
Write-Host "Created $launcherIcoPath"