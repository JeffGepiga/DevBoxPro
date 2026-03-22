/* ============================================================
   DevBox Pro Documentation — Shared JavaScript
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initScrollAnimations();
  initAccordions();
  updateDownloadLinks();
});

function normalizeReleaseVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(left, right) {
  const leftParts = normalizeReleaseVersion(left).split('.').map(part => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeReleaseVersion(right).split('.').map(part => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;

    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function getAssetVersion(name) {
  const match = String(name || '').match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : '';
}

function pickReleaseAsset(assets, matcher, releaseVersion) {
  const candidates = (assets || []).filter(asset => matcher(asset?.name || ''));
  if (!candidates.length) return null;

  const normalizedReleaseVersion = normalizeReleaseVersion(releaseVersion);
  const exactMatch = candidates.find(asset => getAssetVersion(asset.name) === normalizedReleaseVersion);
  if (exactMatch) return exactMatch;

  return candidates
    .slice()
    .sort((left, right) => compareVersions(getAssetVersion(right.name), getAssetVersion(left.name)))[0];
}

async function updateDownloadLinks() {
  try {
    const response = await fetch('https://api.github.com/repos/JeffGepiga/DevBoxPro/releases/latest');
    const data = await response.json();
    
    if (data && data.assets) {
      const releaseVersion = data.tag_name || data.name;
      const setupAsset = pickReleaseAsset(data.assets, name => /setup/i.test(name) && name.endsWith('.exe'), releaseVersion);
      const portableAsset = pickReleaseAsset(data.assets, name => !/setup/i.test(name) && name.endsWith('.exe'), releaseVersion);
      
      if (setupAsset) {
        document.querySelectorAll('.download-setup-btn').forEach(btn => {
          btn.href = setupAsset.browser_download_url;
        });
      }
      
      if (portableAsset) {
        document.querySelectorAll('.download-portable-btn').forEach(btn => {
          btn.href = portableAsset.browser_download_url;
        });
      }
    }
  } catch (err) {
    console.error('Failed to fetch latest release:', err);
  }
}


/* ---------- Navbar ---------- */
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  // Scroll effect
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  });
  // Fire once on load
  navbar.classList.toggle('scrolled', window.scrollY > 40);

  // Mobile toggle
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      links.classList.toggle('open');
    });

    // Close menu on link click (mobile)
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('open');
        links.classList.remove('open');
      });
    });
  }
}

/* ---------- Scroll Animations ---------- */
function initScrollAnimations() {
  const elements = document.querySelectorAll('.animate-in');
  if (!elements.length) return;

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  elements.forEach(el => observer.observe(el));
}

/* ---------- Accordions / FAQ ---------- */
function initAccordions() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const item = header.closest('.accordion-item');
      const body = item.querySelector('.accordion-body');
      const isOpen = item.classList.contains('open');

      // Close all
      document.querySelectorAll('.accordion-item.open').forEach(openItem => {
        openItem.classList.remove('open');
        openItem.querySelector('.accordion-body').style.maxHeight = null;
      });

      // Toggle current
      if (!isOpen) {
        item.classList.add('open');
        body.style.maxHeight = body.scrollHeight + 'px';
      }
    });
  });
}
