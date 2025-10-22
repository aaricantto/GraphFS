# Copy multiple files to Windows clipboard
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File copy_files.ps1 "C:\file1.txt" "C:\file2.txt"

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$FilePaths
)

# Filter to only existing files
$validFiles = $FilePaths | Where-Object { Test-Path $_ -PathType Leaf } | ForEach-Object { Get-Item $_ }

if ($validFiles.Count -eq 0) {
    Write-Error "No valid files provided"
    exit 1
}

try {
    Add-Type -AssemblyName System.Windows.Forms
    
    # Create a StringCollection containing the file paths
    $fileCollection = New-Object System.Collections.Specialized.StringCollection
    foreach ($file in $validFiles) {
        $fileCollection.Add($file.FullName)
    }
    
    # Copy to clipboard using the FileDrop format
    [System.Windows.Forms.Clipboard]::SetFileDropList($fileCollection)
    
    Write-Host "Successfully copied $($validFiles.Count) file(s) to clipboard"
    exit 0
}
catch {
    Write-Error "Failed to copy files to clipboard: $_"
    exit 1
}