# Clone and Dockerize Script for KiranCareWellness
param (
    [string]$TargetDir = "C:\Users\Nilesh\Downloads\myCode\KiranCareWellness"
)

$SourceDir = Get-Location
# Ensure TargetDir is absolute
$TargetAbsolutePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($TargetDir)

Write-Host "Preparing to clone from '$SourceDir' to '$TargetAbsolutePath'..."

# Create target directory if it doesn't exist
if (-not (Test-Path -Path $TargetAbsolutePath)) {
    New-Item -ItemType Directory -Force -Path $TargetAbsolutePath | Out-Null
    Write-Host "Created directory: $TargetAbsolutePath"
}

# Use Robocopy for efficient syncing with exclusions
# /E = recursive including empty dirs
# /XD = exclude directories
# /XF = exclude files
# /NFL /NDL = No File List, No Directory List (less output)
# /NJH /NJS = No Job Header, No Job Summary (less output) - keeping summary for confirmation
Write-Host "Copying files (this may take a moment)..."
$robocopyArgs = @(
    $SourceDir,
    $TargetAbsolutePath,
    "/E",
    "/XD", "node_modules", "venv", ".git", ".wwebjs_auth", "temp", "__pycache__", ".vs", ".vscode", "dist", "build",
    "/XF", "*.log", "*.tmp", "*.DS_Store", "Thumbs.db"
)

# Start-Process -Wait to handle robocopy exit codes correctly
$p = Start-Process -FilePath "robocopy" -ArgumentList $robocopyArgs -Wait -PassThru

# Robocopy exit codes: 0-7 are success (files copied, no errors, etc.)
if ($p.ExitCode -gt 7) {
    Write-Error "Robocopy failed with exit code $($p.ExitCode)"
    exit 1
}

Write-Host "Copy complete."

# -------------------------------------------------------------------------
# Create Dockerfile
# -------------------------------------------------------------------------
Write-Host "Creating Dockerfile..."
$dockerfileContent = @"
FROM node:18-bullseye

# Install Python and pip
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy server package files first for caching
COPY server/package*.json ./server/

# Install Node.js dependencies
WORKDIR /usr/src/app/server
RUN npm install

# Copy Python requirements
COPY server/python-services/requirements.txt ./python-services/

# Install Python dependencies in a virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:`$PATH"
RUN pip install -r ./python-services/requirements.txt

# Return to root app dir
WORKDIR /usr/src/app

# Copy the rest of the application
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "server/app.js"]
"@

Set-Content -Path "$TargetAbsolutePath\Dockerfile" -Value $dockerfileContent -Encoding UTF8

# -------------------------------------------------------------------------
# Create .dockerignore
# -------------------------------------------------------------------------
Write-Host "Creating .dockerignore..."
$dockerIgnoreContent = @"
node_modules
npm-debug.log
Dockerfile
.dockerignore
.git
.gitignore
README.md
LICENSE
# python
__pycache__
*.pyc
*.pyo
*.pyd
.Python
env/
venv/
pip-log.txt
pip-delete-this-directory.txt
.tox/
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
*.log
.pytest_cache/
# local specific
.wwebjs_auth/
server/uploads/
"@

Set-Content -Path "$TargetAbsolutePath\.dockerignore" -Value $dockerIgnoreContent -Encoding UTF8

# -------------------------------------------------------------------------
# Update server/db.js to support Environment Variables
# -------------------------------------------------------------------------
Write-Host "Updating server/db.js to use environment variables..."
$dbJsPath = "$TargetAbsolutePath\server\db.js"

if (Test-Path $dbJsPath) {
    $dbJsContent = Get-Content -Path $dbJsPath -Raw
    
    # Replace hardcoded values with process.env || default
    # Note: We keep the original values as fallbacks for backward compatibility/ease of testing
    $newDbJsContent = $dbJsContent -replace "host:\s*'localhost'", "host: process.env.DB_HOST || 'localhost'"
    $newDbJsContent = $newDbJsContent -replace "user:\s*'root'", "user: process.env.DB_USER || 'root'"
    $newDbJsContent = $newDbJsContent -replace "password:\s*'Ritesh45'", "password: process.env.DB_PASSWORD || 'Ritesh45'"
    $newDbJsContent = $newDbJsContent -replace "database:\s*'kirancarewellness'", "database: process.env.DB_NAME || 'kirancarewellness'"
    
    Set-Content -Path $dbJsPath -Value $newDbJsContent -Encoding UTF8
} else {
    Write-Warning "Could not find server/db.js to update."
}

# -------------------------------------------------------------------------
# Create .env.example
# -------------------------------------------------------------------------
Write-Host "Creating server/.env.example..."
$envContent = @"
# Database Configuration
# Use 'host.docker.internal' to access localhost from inside Docker on Windows/Mac
DB_HOST=host.docker.internal
DB_USER=root
DB_PASSWORD=Ritesh45
DB_NAME=kirancarewellness
"@

Set-Content -Path "$TargetAbsolutePath\server\.env.example" -Value $envContent -Encoding UTF8

Write-Host "----------------------------------------------------------------"
Write-Host "SUCCESS!"
Write-Host "Project cloned to: $TargetAbsolutePath"
Write-Host "To build the Docker image, run:"
Write-Host "  cd $TargetAbsolutePath"
Write-Host "  docker build -t kirancarewellness ."
Write-Host "To run the container (connects to your local DB):"
Write-Host "  docker run -p 3000:3000 --env-file server/.env.example kirancarewellness"
Write-Host "----------------------------------------------------------------"
