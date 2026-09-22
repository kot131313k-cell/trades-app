$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$l = New-Object Net.HttpListener
$l.Prefixes.Add('http://127.0.0.1:8000/')
$l.Start()
Write-Output "serving $root on http://127.0.0.1:8000/"
$ct = @{ '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css'; '.js' = 'text/javascript'; '.json' = 'application/json' }
while ($l.IsListening) {
  $c = $l.GetContext()
  $rel = $c.Request.Url.LocalPath.TrimStart('/')
  $p = Join-Path $root $rel
  if ((Test-Path $p -PathType Container) -or -not (Test-Path $p)) { $p = Join-Path $root 'index.html' }
  $b = [IO.File]::ReadAllBytes($p)
  $ext = [IO.Path]::GetExtension($p)
  if ($ct.ContainsKey($ext)) { $c.Response.ContentType = $ct[$ext] }
  $c.Response.ContentLength64 = $b.Length
  $c.Response.OutputStream.Write($b, 0, $b.Length)
  $c.Response.Close()
}
