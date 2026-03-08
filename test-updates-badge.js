const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('Launching Electron...');
  const appPath = path.join(__dirname, 'src', 'main', 'main.js');
  
  const electronApp = await electron.launch({
    args: [appPath]
  });

  const window = await electronApp.firstWindow();
  
  // Wait for the app to load
  console.log('Waiting for app to load...');
  await window.waitForLoadState('networkidle');
  await window.waitForTimeout(3000); // Give React time to mount

  // Click on the Binaries navigation item
  console.log('Navigating to Binaries...');
  await window.click('text="Binaries"');
  
  // Wait for the Binaries page to load
  await window.waitForTimeout(2000);
  
  // Ensure the Language tab is selected (where Composer is located)
  await window.click('text="Languages"');
  await window.waitForTimeout(1000);

  // Take a screenshot of the whole window
  const screenshotPath = path.join(__dirname, 'updates-badge.png');
  await window.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to ${screenshotPath}`);

  await electronApp.close();
})();
