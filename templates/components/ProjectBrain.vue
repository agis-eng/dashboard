<template>
  <div class="project-brain">
    <!-- Project Selector -->
    <div class="brain-header">
      <h2>Project Brain 🧠</h2>
      <select v-model="selectedProjectId" @change="loadProject" class="project-selector">
        <option value="">Select a project...</option>
        <option v-for="proj in projects" :key="proj.id" :value="proj.id">
          {{ proj.name }}
        </option>
      </select>
    </div>

    <!-- Search Bar -->
    <div v-if="selectedProjectId" class="search-section">
      <input
        v-model="searchQuery"
        @keyup.enter="performSearch"
        type="text"
        placeholder="Search this project's brain..."
        class="search-input"
      />
      <button @click="performSearch" class="search-btn">Search</button>
    </div>

    <!-- Project Info -->
    <div v-if="projectInfo" class="project-info">
      <h3>{{ projectInfo.projectName }}</h3>
      <p><strong>Client:</strong> {{ projectInfo.client }}</p>
      <p><strong>Owner:</strong> {{ projectInfo.owner }}</p>
      <p><strong>Documents:</strong> {{ projectInfo.totalDocuments }}</p>
    </div>

    <!-- Documents List -->
    <div v-if="selectedProjectId && !searchPerformed" class="documents-section">
      <h4>📄 Brain Documents</h4>
      <ul class="document-list">
        <li v-for="doc in projectInfo?.brainDocuments" :key="doc.filename" class="doc-item">
          <a href="#" @click.prevent="viewDocument(doc.filename)">
            {{ doc.filename }}
          </a>
          <span class="doc-type">{{ doc.type }}</span>
          <span class="doc-size">{{ formatBytes(doc.size) }}</span>
        </li>
      </ul>
    </div>

    <!-- Search Results -->
    <div v-if="searchPerformed" class="search-results">
      <h4>Search Results for "{{ searchQuery }}"</h4>
      <p v-if="searchResults.length === 0" class="no-results">
        No results found. Try different keywords.
      </p>
      <div v-for="(result, idx) in searchResults" :key="idx" class="result-item">
        <h5>{{ result.filename }}</h5>
        <p class="snippet" v-html="highlightSnippet(result.snippet || result.line)"></p>
        <button
          @click="viewDocument(result.filename)"
          class="view-btn"
        >
          View Document
        </button>
      </div>
    </div>

    <!-- Document Viewer -->
    <div v-if="viewingDocument" class="document-viewer">
      <div class="viewer-header">
        <h4>{{ currentDocument }}</h4>
        <button @click="closeViewer" class="close-btn">Close</button>
      </div>
      <div class="viewer-content">
        <pre>{{ documentContent }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ProjectBrain',
  data() {
    return {
      projects: [],
      selectedProjectId: '',
      projectInfo: null,
      searchQuery: '',
      searchResults: [],
      searchPerformed: false,
      viewingDocument: false,
      currentDocument: '',
      documentContent: '',
    };
  },
  async mounted() {
    await this.loadProjects();
  },
  methods: {
    async loadProjects() {
      try {
        const response = await fetch('/api/projects-brain');
        const data = await response.json();
        this.projects = data.projects;
      } catch (err) {
        console.error('Error loading projects:', err);
      }
    },
    async loadProject() {
      if (!this.selectedProjectId) {
        this.projectInfo = null;
        return;
      }

      try {
        const response = await fetch(
          `/api/projects-brain?projectId=${this.selectedProjectId}&action=summary`
        );
        const data = await response.json();
        this.projectInfo = data;
        this.searchPerformed = false;
        this.viewingDocument = false;
      } catch (err) {
        console.error('Error loading project:', err);
      }
    },
    async performSearch() {
      if (!this.searchQuery.trim()) return;

      try {
        const response = await fetch(
          `/api/projects-brain?projectId=${this.selectedProjectId}&action=search&q=${encodeURIComponent(
            this.searchQuery
          )}`
        );
        const data = await response.json();
        this.searchResults = data.results || [];
        this.searchPerformed = true;
        this.viewingDocument = false;
      } catch (err) {
        console.error('Error searching:', err);
      }
    },
    async viewDocument(filename) {
      try {
        const response = await fetch(
          `/api/projects-brain?projectId=${this.selectedProjectId}&action=content&filename=${encodeURIComponent(
            filename
          )}`
        );
        const data = await response.json();
        this.currentDocument = filename;
        this.documentContent = data.content || '[Binary or unsupported format]';
        this.viewingDocument = true;
      } catch (err) {
        console.error('Error loading document:', err);
      }
    },
    closeViewer() {
      this.viewingDocument = false;
      this.currentDocument = '';
      this.documentContent = '';
    },
    formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },
    highlightSnippet(text) {
      if (!text || !this.searchQuery) return text;
      const regex = new RegExp(`(${this.searchQuery})`, 'gi');
      return text.replace(regex, '<mark>$1</mark>');
    },
  },
};
</script>

<style scoped>
.project-brain {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.brain-header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
}

.brain-header h2 {
  margin: 0;
}

.project-selector {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  min-width: 250px;
}

.search-section {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.search-input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.search-btn {
  padding: 10px 20px;
  background-color: #0066cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.search-btn:hover {
  background-color: #0052a3;
}

.project-info {
  background-color: #f5f5f5;
  padding: 15px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.project-info h3 {
  margin: 0 0 10px 0;
}

.project-info p {
  margin: 5px 0;
  font-size: 14px;
}

.documents-section {
  margin-bottom: 20px;
}

.documents-section h4 {
  margin-top: 0;
  font-size: 16px;
}

.document-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.doc-item {
  padding: 10px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.doc-item a {
  color: #0066cc;
  text-decoration: none;
  cursor: pointer;
}

.doc-item a:hover {
  text-decoration: underline;
}

.doc-type {
  background-color: #e3f2fd;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 12px;
  color: #0066cc;
}

.doc-size {
  color: #999;
  font-size: 12px;
}

.search-results {
  margin-top: 20px;
}

.search-results h4 {
  margin-top: 0;
  font-size: 16px;
}

.no-results {
  color: #999;
  font-size: 14px;
}

.result-item {
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 15px;
  margin-bottom: 10px;
}

.result-item h5 {
  margin: 0 0 10px 0;
  color: #0066cc;
}

.snippet {
  background-color: #f9f9f9;
  padding: 10px;
  border-radius: 3px;
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 10px 0;
  color: #333;
}

.snippet mark {
  background-color: #ffeb3b;
  padding: 2px 4px;
  border-radius: 2px;
  font-weight: bold;
}

.view-btn {
  padding: 6px 12px;
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.view-btn:hover {
  background-color: #e0e0e0;
}

.document-viewer {
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-top: 20px;
  background-color: #f9f9f9;
}

.viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  border-bottom: 1px solid #ddd;
  background-color: #fff;
}

.viewer-header h4 {
  margin: 0;
}

.close-btn {
  padding: 6px 12px;
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.close-btn:hover {
  background-color: #e0e0e0;
}

.viewer-content {
  padding: 15px;
  max-height: 600px;
  overflow-y: auto;
  background-color: #fff;
}

.viewer-content pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
