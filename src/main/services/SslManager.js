const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');

class SslManager {
  constructor(resourcePath, configStore) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.certsPath = null;
    this.caPath = null;
  }

  async initialize() {
    console.log('Initializing SslManager...');

    // Use the same data path as ProjectManager (app.getPath('userData')/data)
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    this.certsPath = path.join(dataPath, 'ssl', 'certs');
    this.caPath = path.join(dataPath, 'ssl', 'ca');

    await fs.ensureDir(this.certsPath);
    await fs.ensureDir(this.caPath);

    // Check if CA certificate exists, create if not
    const caCertPath = path.join(this.caPath, 'rootCA.pem');
    const isNewCA = !(await fs.pathExists(caCertPath));
    
    if (isNewCA) {
      console.log('Creating root CA certificate...');
      await this.createRootCA();
      
      // Automatically prompt to trust the new Root CA
      console.log('Prompting user to trust Root CA...');
      await this.promptTrustRootCA();
    }

    console.log('SslManager initialized');
  }

  // Prompt user to trust the Root CA certificate
  async promptTrustRootCA() {
    const caCertPath = path.join(this.caPath, 'rootCA.pem');
    
    try {
      if (process.platform === 'win32') {
        // Windows: Use certutil with sudo-prompt for elevation
        console.log('Adding Root CA to Windows trusted certificates...');
        const sudo = require('sudo-prompt');
        const options = {
          name: 'DevBox Pro',
        };
        
        return new Promise((resolve, reject) => {
          // Use certutil to add to local machine root store (requires admin)
          const command = `certutil -addstore -f "Root" "${caCertPath}"`;
          
          sudo.exec(command, options, (error, stdout, stderr) => {
            if (error) {
              console.warn('Could not add Root CA to trusted store:', error.message);
              console.log('You may need to manually trust the certificate at:', caCertPath);
              console.log('To trust manually: Double-click the certificate > Install Certificate > Local Machine > Trusted Root Certification Authorities');
              resolve(); // Don't fail initialization
            } else {
              console.log('Root CA certificate trusted successfully');
              resolve();
            }
          });
        });
      } else if (process.platform === 'darwin') {
        // macOS: Add to login keychain (requires user password)
        console.log('Adding Root CA to macOS keychain...');
        await this.runCommand('security', [
          'add-trusted-cert',
          '-r', 'trustRoot',
          '-k', path.join(process.env.HOME, 'Library/Keychains/login.keychain-db'),
          caCertPath
        ]);
        console.log('Root CA certificate trusted successfully');
      }
    } catch (error) {
      console.warn('Could not automatically trust Root CA:', error.message);
      console.log('You may need to manually trust the certificate at:', caCertPath);
    }
  }

  async createRootCA() {
    const keyPath = path.join(this.caPath, 'rootCA-key.pem');
    const certPath = path.join(this.caPath, 'rootCA.pem');

    // Generate private key
    await this.generatePrivateKey(keyPath);

    // Generate self-signed root certificate
    const config = this.createOpenSSLConfig('DevBox Pro Root CA', [], true);
    const configPath = path.join(this.caPath, 'ca.cnf');
    await fs.writeFile(configPath, config);

    await this.runOpenSSL([
      'req',
      '-x509',
      '-new',
      '-nodes',
      '-key',
      keyPath,
      '-sha256',
      '-days',
      '3650',
      '-out',
      certPath,
      '-config',
      configPath,
      '-extensions',
      'v3_ca',
    ]);

    console.log('Root CA certificate created');
    return { keyPath, certPath };
  }

  async createCertificate(domains) {
    if (!Array.isArray(domains) || domains.length === 0) {
      throw new Error('At least one domain is required');
    }

    const primaryDomain = domains[0];
    const certName = this.sanitizeCertName(primaryDomain);

    // Create per-domain directory for certificates
    const domainCertDir = path.join(this.certsPath, '..', primaryDomain);
    await fs.ensureDir(domainCertDir);

    // Use naming convention expected by ProjectManager: cert.pem and key.pem
    const keyPath = path.join(domainCertDir, 'key.pem');
    const csrPath = path.join(domainCertDir, `${certName}.csr`);
    const certPath = path.join(domainCertDir, 'cert.pem');

    console.log(`Creating certificate for: ${domains.join(', ')}`);

    // Generate private key
    await this.generatePrivateKey(keyPath);

    // Create CSR config with SANs
    const config = this.createOpenSSLConfig(primaryDomain, domains);
    const configPath = path.join(domainCertDir, `${certName}.cnf`);
    await fs.writeFile(configPath, config);

    // Generate CSR
    await this.runOpenSSL([
      'req',
      '-new',
      '-key',
      keyPath,
      '-out',
      csrPath,
      '-config',
      configPath,
    ]);

    // Sign with root CA
    const caKeyPath = path.join(this.caPath, 'rootCA-key.pem');
    const caCertPath = path.join(this.caPath, 'rootCA.pem');

    await this.runOpenSSL([
      'x509',
      '-req',
      '-in',
      csrPath,
      '-CA',
      caCertPath,
      '-CAkey',
      caKeyPath,
      '-CAcreateserial',
      '-out',
      certPath,
      '-days',
      '825',
      '-sha256',
      '-extfile',
      configPath,
      '-extensions',
      'v3_req',
    ]);

    // Store certificate info
    const certificates = this.configStore.get('certificates', {});
    certificates[primaryDomain] = {
      domains,
      keyPath,
      certPath,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 825 * 24 * 60 * 60 * 1000).toISOString(),
    };
    this.configStore.set('certificates', certificates);

    console.log(`Certificate created for ${primaryDomain}`);

    return {
      domain: primaryDomain,
      domains,
      keyPath,
      certPath,
    };
  }

  async deleteCertificate(domain) {
    const certificates = this.configStore.get('certificates', {});
    const cert = certificates[domain];

    if (!cert) {
      throw new Error(`Certificate for ${domain} not found`);
    }

    // Delete per-domain certificate directory
    const domainCertDir = path.join(this.certsPath, '..', domain);
    if (await fs.pathExists(domainCertDir)) {
      await fs.remove(domainCertDir);
    }

    // Remove from config
    delete certificates[domain];
    this.configStore.set('certificates', certificates);

    console.log(`Certificate for ${domain} deleted`);
    return { success: true };
  }

  async trustCertificate(domain) {
    const certificates = this.configStore.get('certificates', {});
    const cert = certificates[domain];

    if (!cert) {
      throw new Error(`Certificate for ${domain} not found`);
    }

    // Trust the root CA instead of individual certificates
    const caCertPath = path.join(this.caPath, 'rootCA.pem');

    try {
      if (process.platform === 'darwin') {
        // macOS: Add to System Keychain
        await this.runCommand('sudo', [
          'security',
          'add-trusted-cert',
          '-d',
          '-r',
          'trustRoot',
          '-k',
          '/Library/Keychains/System.keychain',
          caCertPath,
        ]);
      } else if (process.platform === 'win32') {
        // Windows: Add to certificate store with elevation
        const sudo = require('sudo-prompt');
        const options = { name: 'DevBox Pro' };
        
        return new Promise((resolve) => {
          const command = `certutil -addstore -f "Root" "${caCertPath}"`;
          sudo.exec(command, options, (error, stdout, stderr) => {
            if (error) {
              console.error('Failed to trust certificate:', error);
              resolve({
                success: false,
                error: error.message,
                manual: this.getTrustInstructions(),
              });
            } else {
              console.log('Root CA certificate trusted');
              resolve({ success: true, message: 'Certificate trusted successfully' });
            }
          });
        });
      }

      console.log('Root CA certificate trusted');
      return { success: true, message: 'Certificate trusted successfully' };
    } catch (error) {
      console.error('Failed to trust certificate:', error);
      return {
        success: false,
        error: error.message,
        manual: this.getTrustInstructions(),
      };
    }
  }

  getTrustInstructions() {
    const caCertPath = path.join(this.caPath, 'rootCA.pem');

    if (process.platform === 'darwin') {
      return `To trust the DevBox Pro certificate manually:
1. Open Keychain Access
2. File > Import Items
3. Select: ${caCertPath}
4. Double-click the imported certificate
5. Expand "Trust" and set "When using this certificate" to "Always Trust"`;
    } else if (process.platform === 'win32') {
      return `To trust the DevBox Pro certificate manually:
1. Double-click: ${caCertPath}
2. Click "Install Certificate"
3. Select "Current User" or "Local Machine"
4. Choose "Place all certificates in the following store"
5. Browse and select "Trusted Root Certification Authorities"
6. Click "Finish"`;
    }

    return 'Please consult your OS documentation for trusting SSL certificates.';
  }

  listCertificates() {
    return this.configStore.get('certificates', {});
  }

  getCertificate(domain) {
    const certificates = this.configStore.get('certificates', {});
    return certificates[domain] || null;
  }

  getCertificatePaths(domain) {
    const cert = this.getCertificate(domain);
    if (!cert) return null;

    return {
      key: cert.keyPath,
      cert: cert.certPath,
    };
  }

  // Helper methods
  sanitizeCertName(domain) {
    return domain.replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  async generatePrivateKey(keyPath) {
    await this.runOpenSSL(['genrsa', '-out', keyPath, '2048']);
  }

  createOpenSSLConfig(commonName, domains, isCA = false) {
    let config = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
`;

    // Only add req_extensions for non-CA certs with domains
    if (!isCA && domains.length > 0) {
      config += `req_extensions = v3_req
`;
    }

    config += `
[dn]
C = US
ST = Local
L = Local
O = DevBox Pro
OU = Development
CN = ${commonName}
`;

    // Only add v3_req section for non-CA certificates with domains
    if (!isCA && domains.length > 0) {
      config += `
[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
`;
      domains.forEach((domain, index) => {
        config += `DNS.${index + 1} = ${domain}\n`;
        if (!domain.includes('*')) {
          config += `DNS.${index + 1 + domains.length} = *.${domain}\n`;
        }
      });
    }

    if (isCA) {
      config += `
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always, issuer
`;
    }

    return config;
  }

  async runOpenSSL(args) {
    const opensslPath = this.getOpenSSLPath();

    return new Promise((resolve, reject) => {
      const proc = spawn(opensslPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`OpenSSL failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  async runCommand(command, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  getOpenSSLPath() {
    // On macOS and Linux, OpenSSL is typically in PATH
    // On Windows, we might bundle it or use the system one
    if (process.platform === 'win32') {
      const bundledPath = path.join(this.resourcePath, 'openssl', 'openssl.exe');
      if (fs.existsSync(bundledPath)) {
        return bundledPath;
      }
      return 'openssl'; // Fall back to system OpenSSL
    }
    return 'openssl';
  }
}

module.exports = { SslManager };
