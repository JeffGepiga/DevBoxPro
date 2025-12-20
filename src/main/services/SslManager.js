const path = require('path');
const fs = require('fs-extra');
const forge = require('node-forge');

class SslManager {
  constructor(resourcePath, configStore, managers = {}) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.certsPath = null;
    this.caPath = null;
    this.caKey = null;
    this.caCert = null;
  }

  async initialize() {

    // Use the same data path as ProjectManager (app.getPath('userData')/data)
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    this.certsPath = path.join(dataPath, 'ssl', 'certs');
    this.caPath = path.join(dataPath, 'ssl', 'ca');

    await fs.ensureDir(this.certsPath);
    await fs.ensureDir(this.caPath);

    // Check if CA certificate exists, create if not
    const caCertPath = path.join(this.caPath, 'rootCA.pem');
    const caKeyPath = path.join(this.caPath, 'rootCA-key.pem');
    const isNewCA = !(await fs.pathExists(caCertPath));

    if (isNewCA) {
      try {
        await this.createRootCA();

        // Automatically prompt to trust the new Root CA
        await this.promptTrustRootCA();
      } catch (error) {
        this.managers.log?.systemError('Failed to create Root CA certificate', { error: error.message });
      }
    } else {
      // Load existing CA
      try {
        const caKeyPem = await fs.readFile(caKeyPath, 'utf8');
        const caCertPem = await fs.readFile(caCertPath, 'utf8');
        this.caKey = forge.pki.privateKeyFromPem(caKeyPem);
        this.caCert = forge.pki.certificateFromPem(caCertPem);
      } catch (error) {
        this.managers.log?.systemError('Failed to load existing Root CA', { error: error.message });
      }
    }
  }

  // Prompt user to trust the Root CA certificate
  async promptTrustRootCA() {
    const caCertPath = path.join(this.caPath, 'rootCA.pem');

    try {
      if (process.platform === 'win32') {
        // Windows: Use certutil with sudo-prompt for elevation
        const sudo = require('sudo-prompt');
        const options = {
          name: 'DevBox Pro',
        };

        return new Promise((resolve) => {
          // Use certutil to add to local machine root store (requires admin)
          const command = `certutil -f -addstore "Root" "${caCertPath}"`;

          sudo.exec(command, options, (error, stdout, stderr) => {
            // Resolve regardless of error - don't fail initialization
            resolve();
          });
        });
      } else if (process.platform === 'darwin') {
        // macOS: Add to login keychain (requires user password)
        const { spawn } = require('child_process');

        return new Promise((resolve) => {
          const proc = spawn('security', [
            'add-trusted-cert',
            '-r', 'trustRoot',
            '-k', path.join(process.env.HOME, 'Library/Keychains/login.keychain-db'),
            caCertPath
          ]);

          proc.on('close', (code) => {
            resolve();
          });

          proc.on('error', () => {
            resolve();
          });
        });
      }
    } catch (error) {
      // Could not automatically trust Root CA - user will need to do it manually
    }
  }

  async createRootCA() {
    const keyPath = path.join(this.caPath, 'rootCA-key.pem');
    const certPath = path.join(this.caPath, 'rootCA.pem');

    // Generate a 2048-bit RSA key pair
    const keys = forge.pki.rsa.generateKeyPair(2048);
    this.caKey = keys.privateKey;

    // Create the certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';

    // Valid for 10 years
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

    // Set subject and issuer (same for self-signed CA)
    const attrs = [
      { name: 'commonName', value: 'DevBox Pro Root CA' },
      { name: 'countryName', value: 'US' },
      { shortName: 'ST', value: 'Local' },
      { name: 'localityName', value: 'Local' },
      { name: 'organizationName', value: 'DevBox Pro' },
      { shortName: 'OU', value: 'Development' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    // Set extensions for CA certificate
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: true,
        critical: true
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        cRLSign: true,
        digitalSignature: true,
        critical: true
      },
      {
        name: 'subjectKeyIdentifier'
      }
    ]);

    // Self-sign the certificate
    cert.sign(keys.privateKey, forge.md.sha256.create());
    this.caCert = cert;

    // Convert to PEM format and save
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certPem = forge.pki.certificateToPem(cert);

    await fs.writeFile(keyPath, keyPem);
    await fs.writeFile(certPath, certPem);

    return { keyPath, certPath };
  }

  async createCertificate(domains) {
    if (!Array.isArray(domains) || domains.length === 0) {
      throw new Error('At least one domain is required');
    }

    if (!this.caKey || !this.caCert) {
      throw new Error('Root CA not initialized. Please restart the application.');
    }

    const primaryDomain = domains[0];

    // Create per-domain directory for certificates
    const domainCertDir = path.join(this.certsPath, '..', primaryDomain);
    await fs.ensureDir(domainCertDir);

    const keyPath = path.join(domainCertDir, 'key.pem');
    const certPath = path.join(domainCertDir, 'cert.pem');

    // Generate key pair for the domain certificate
    const keys = forge.pki.rsa.generateKeyPair(2048);

    // Create the certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Date.now().toString(16);

    // Valid for ~2 years (825 days for browser compatibility)
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + 825);

    // Set subject
    const attrs = [
      { name: 'commonName', value: primaryDomain },
      { name: 'countryName', value: 'US' },
      { shortName: 'ST', value: 'Local' },
      { name: 'localityName', value: 'Local' },
      { name: 'organizationName', value: 'DevBox Pro' },
      { shortName: 'OU', value: 'Development' }
    ];
    cert.setSubject(attrs);

    // Set issuer from CA certificate
    cert.setIssuer(this.caCert.subject.attributes);

    // Build Subject Alternative Names
    const altNames = [];
    domains.forEach((domain) => {
      altNames.push({ type: 2, value: domain }); // DNS name
      // Add wildcard for non-wildcard domains
      if (!domain.startsWith('*.')) {
        altNames.push({ type: 2, value: `*.${domain}` });
      }
    });

    // Set extensions
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: false
      },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
        nonRepudiation: true
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true
      },
      {
        name: 'subjectAltName',
        altNames: altNames
      },
      {
        name: 'subjectKeyIdentifier'
      },
      {
        name: 'authorityKeyIdentifier',
        keyIdentifier: true
      }
    ]);

    // Sign with CA private key
    cert.sign(this.caKey, forge.md.sha256.create());

    // Convert to PEM format and save
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certPem = forge.pki.certificateToPem(cert);

    await fs.writeFile(keyPath, keyPem);
    await fs.writeFile(certPath, certPem);

    // Store certificate info
    const certificates = this.configStore.get('certificates', {});
    certificates[primaryDomain] = {
      domains,
      keyPath,
      certPath,
      createdAt: new Date().toISOString(),
      expiresAt: cert.validity.notAfter.toISOString(),
    };
    this.configStore.set('certificates', certificates);

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
        return new Promise((resolve) => {
          const sudo = require('sudo-prompt');
          const command = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caCertPath}"`;

          sudo.exec(command, { name: 'DevBox Pro' }, (error) => {
            if (error) {
              resolve({
                success: false,
                error: error.message,
                manual: this.getTrustInstructions(),
              });
            } else {
              resolve({ success: true, message: 'Certificate trusted successfully' });
            }
          });
        });
      } else if (process.platform === 'win32') {
        // Windows: Add to certificate store with elevation
        const sudo = require('sudo-prompt');

        return new Promise((resolve) => {
          const command = `certutil -addstore -f "Root" "${caCertPath}"`;
          sudo.exec(command, { name: 'DevBox Pro' }, (error) => {
            if (error) {
              resolve({
                success: false,
                error: error.message,
                manual: this.getTrustInstructions(),
              });
            } else {
              resolve({ success: true, message: 'Certificate trusted successfully' });
            }
          });
        });
      }

      return { success: true, message: 'Certificate trusted successfully' };
    } catch (error) {
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

  // Get SSL status for UI
  getStatus() {
    return {
      initialized: !!(this.caKey && this.caCert),
      certsPath: this.certsPath,
      caPath: this.caPath,
    };
  }

  // Check if SSL is available
  isAvailable() {
    return !!(this.caKey && this.caCert);
  }
}

module.exports = { SslManager };
