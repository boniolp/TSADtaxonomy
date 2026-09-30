<p align="center">
<img width="220" src="./assets/intro.jpg"/>
</p>


<h1 align="center">TSADtaxonomy</h1>
<h2 align="center"> Time Series Anomaly Detection Taxonomy</h2>


## TSADtaxonomy in short
This application helps users explore and understand the vast array of existing methods, ranging from traditional statistical approaches to modern machine learning algorithms. It visualizes a structured, process-centric taxonomy of anomaly detection techniques, enabling a deeper insight into the research landscape.

## 🔍 Features
- **Taxonomy map**: navigate the process-centric taxonomy, with every method placed at its publication year and its variants linked to it. Zoom, pan, and export the current view as an SVG figure for your slides or papers.
- **Search and filters**: find methods by name, author or keyword, and filter by approach, category, dimensionality, supervision, streaming support, publication year and code availability.
- **Table view**: sort all methods, and export the filtered list as CSV, BibTeX or JSON.
- **Insights**: see how the field evolved (methods per period and per category, share of multivariate, unsupervised, streaming, and open-source methods), all computed live on your filters.
- **Find a method**: answer five questions about your data to get a ranked shortlist of methods whose properties fit your setting.
- **Compare and cite**: select methods, compare them side by side, and download a single `.bib` for all of them.
- **Shareable links**: every view, filter, selection, and method has its own URL.
- **Contribute in the browser**: a form (with BibTeX pre-fill) generates the method file and opens a pre-filled pull request or issue.
- Dark mode, keyboard shortcuts (`/` to search, `Esc` to close), and mobile layout.

## 🌐 Try it Online

Explore our taxonomy: 👉 [**TSADtaxonomy**](https://boniolp.github.io/TSADtaxonomy/)

## A method is missing?

We welcome contributions of new anomaly detection methods. The easiest way is the **Contribute** tab of the website: fill in the form (or paste the BibTeX entry), and it opens a pull request with the generated file for you.

You can also add a JSON file to `methods/` yourself:

```json
{
  "name": "method name (also the file name: methods/<name>.json)",
  "full_name": "A longer name",
  "category": "second-level-in-the-taxonomy",
  "Dim": "Univariate | Multivariate",
  "Sup": "Unsupervised | Semi-supervised | Supervised",
  "Stream": true,
  "year": 2025,
  "authors": ["author1", "author2"],
  "paper": "the title of the paper. The venue or journal.",
  "description": "A short description of what the method does.",
  "code": "https://link/to/the/code",
  "url": "https://link/to/the/paper",
  "bibtex": "@article{bibtex reference}",
  "parent": "the taxonomy node it belongs under, e.g. Tree-based, or IForest for a variant of IForest"
}
```

Thanks to the `parent` field, you do not need to edit `taxonomy.json`: the method is placed in the tree automatically. Every pull request is checked by a GitHub Action (`scripts/build_data.py`) that reports missing fields, invalid values, or duplicate names.

#### Guidelines

- Provide accurate and complete metadata for your method.
- Ensure URLs are valid and accessible.
- Include a clear and concise description.

Thank you for contributing! We alone would struggle to keep track of all the publications on time series anomaly detection.

## 🛠 Development

The site is static (no build tool needed). The data lives in `taxonomy.json` and `methods/*.json`; `scripts/build_data.py` validates them and bundles them into `data/tsad.json`, which the site loads in one request. On every push to `main`, the GitHub Action rebuilds the bundle automatically.

```bash
python scripts/build_data.py        # validate + rebuild data/tsad.json
python scripts/build_data.py --check  # validate only (what CI runs on pull requests)
python -m http.server                 # then open http://localhost:8000
```

If `data/tsad.json` is missing, the site falls back to reading `taxonomy.json` and `methods/*.json` directly. The GitHub repository used for pull-request, issue, and edit links is set at the top of `app/app.js` (`CONFIG`).

## Contributors

- Paul Boniol
- John Paparrizos
- Qinghua Liu
- Mingyi Huang
- Themis Palpanas
- Yash Krishnani

## 📖 How to Cite

If you find this taxonomy helpful in your research, please cite it as follows:

### [Long Survey Paper](https://arxiv.org/abs/2412.20512)

```bibtex
@misc{boniol2024divetimeseriesanomalydetection,
      title={Dive into Time-Series Anomaly Detection: A Decade Review}, 
      author={Paul Boniol and Qinghua Liu and Mingyi Huang and Themis Palpanas and John Paparrizos},
      year={2024},
      eprint={2412.20512},
      archivePrefix={arXiv},
      primaryClass={cs.LG},
      url={https://arxiv.org/abs/2412.20512}, 
}
```

### [Short Survey Paper](https://dl.acm.org/doi/10.1145/3711896.3736565)

```bibtex
@inproceedings{10.1145/3711896.3736565,
      author = {Paparrizos, John and Boniol, Paul and Liu, Qinghua and Palpanas, Themis},
      title = {Advances in Time-Series Anomaly Detection: Algorithms, Benchmarks, and Evaluation Measures},
      year = {2025},
      isbn = {9798400714542},
      publisher = {Association for Computing Machinery},
      address = {New York, NY, USA},
      url = {https://doi.org/10.1145/3711896.3736565},
      doi = {10.1145/3711896.3736565},
      booktitle = {Proceedings of the 31st ACM SIGKDD Conference on Knowledge Discovery and Data Mining V.2},
      pages = {6151–6161},
      numpages = {11},
      location = {Toronto ON, Canada},
      series = {KDD '25}
}
```
