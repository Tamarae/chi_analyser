import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  // Reference data state
  const [referenceData, setReferenceData] = useState([]);
  const [indexedData, setIndexedData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [referenceLoaded, setReferenceLoaded] = useState(false);
  const [referenceCSV, setReferenceCSV] = useState('');

  // Georgian to Latin transcription mapping
  const georgianToLatin = {
    'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z', 'თ': 't',
    'ი': 'i', 'კ': 'k', 'ლ': 'l', 'მ': 'm', 'ნ': 'n', 'ო': 'o', 'პ': 'p', 'ჟ': 'zh',
    'რ': 'r', 'ს': 's', 'ტ': 't', 'უ': 'u', 'ფ': 'f', 'ქ': 'k', 'ღ': 'gh', 'ყ': 'q',
    'შ': 'sh', 'ჩ': 'ch', 'ც': 'c', 'ძ': 'dz', 'წ': 'c', 'ჭ': 'ch', 'ხ': 'x', 'ჯ': 'j', 'ჰ': 'h'
  };

  // Helper function to count morphemes
  const countMorphemes = (morphemes) => {
    if (!morphemes || typeof morphemes !== 'string') return 0;
    // Count morphemes by splitting on hyphens and filtering out empty parts
    return morphemes.split('-').filter(part => part.trim().length > 0).length;
  };
  const createTranscriptionVariants = (georgianWord) => {
    if (!georgianWord || typeof georgianWord !== 'string') return [];

    let variants = new Set();

    // Basic transcription
    let basicLatin = '';
    for (let char of georgianWord.toLowerCase()) {
      basicLatin += georgianToLatin[char] || char;
    }
    variants.add(basicLatin);

    // Common variation patterns
    let variant1 = basicLatin
      .replace(/k/g, "k'")
      .replace(/t/g, "t'")
      .replace(/p/g, "p'")
      .replace(/q/g, "q'");
    variants.add(variant1);

    let variant2 = basicLatin
      .replace(/k'/g, "k")
      .replace(/t'/g, "t")
      .replace(/p'/g, "p")
      .replace(/q'/g, "q");
    variants.add(variant2);

    // Character variations
    variants.add(basicLatin.replace(/c/g, 'ts'));
    variants.add(basicLatin.replace(/c/g, "ts'"));
    variants.add(basicLatin.replace(/ch/g, 'c'));
    variants.add(basicLatin.replace(/ch/g, "ch'"));

    return Array.from(variants).filter(v => v.length > 0);
  };

  // Input state
  const [userCSV, setUserCSV] = useState('');
  const [csvData, setCsvData] = useState([]);
  const [parseProgress, setParseProgress] = useState(0);
  const [batchSize, setBatchSize] = useState(500);
  const [currentBatch, setCurrentBatch] = useState(1);
  const [processingBatch, setProcessingBatch] = useState(false);

  // Results state
  const [matchedResults, setMatchedResults] = useState([]);
  const [matchStats, setMatchStats] = useState({
    total: 0,
    matched: 0,
    unmatched: 0,
    byPOS: {}
  });
  const [showUnmatched, setShowUnmatched] = useState(false);

  // Refs
  const resultsRef = useRef(null);

  // Detect if data is TSV or CSV
  const detectDelimiter = (data) => {
    const firstLine = data.split('\n')[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;

    return tabCount > commaCount ? '\t' : ',';
  };

  // Load reference data
  const loadReferenceData = () => {
    if (!referenceCSV.trim()) {
      setError('Please paste your reference lemma data first.');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const delimiter = detectDelimiter(referenceCSV);
      const fileType = delimiter === '\t' ? 'TSV' : 'CSV';

      Papa.parse(referenceCSV, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        delimiter: delimiter,
        complete: (result) => {
          if (result.data.length > 0) {
            const firstRow = result.data[0];
            const headers = Object.keys(firstRow);
            console.log('Headers detected:', headers);

            // Check for new format with morphemes (Word, Frequency, Lemma, POS, Gloss, Morphemes)
            const hasNewFormat = headers.some(h => h.toLowerCase() === 'word') &&
                                headers.some(h => h.toLowerCase() === 'frequency') &&
                                headers.some(h => h.toLowerCase() === 'lemma') &&
                                headers.some(h => h.toLowerCase() === 'pos') &&
                                headers.some(h => h.toLowerCase() === 'gloss') &&
                                headers.some(h => h.toLowerCase() === 'morphemes');

            // Check for TSV format (Word forms, Lemma, POS, Gloss)
            const hasTSVFormat = headers.some(h => h.toLowerCase().includes('word forms')) &&
                                headers.some(h => h.toLowerCase() === 'lemma') &&
                                headers.some(h => h.toLowerCase() === 'pos') &&
                                headers.some(h => h.toLowerCase() === 'gloss');

            // Check for original CSV format (Words (Frequency), Lemma)
            const hasCSVFormat = headers.some(h => h.toLowerCase().includes('words (frequency)')) &&
                                headers.some(h => h.toLowerCase() === 'lemma');

            if (!hasNewFormat && !hasTSVFormat && !hasCSVFormat) {
              setError(`${fileType} must have one of these formats:\n- New format: "Word", "Frequency", "Lemma", "POS", "Gloss", "Morphemes" columns\n- TSV format: "Word forms", "Lemma", "POS", "Gloss" columns\n- CSV format: "Words (Frequency)", "Lemma" columns`);
              setLoading(false);
              return;
            }

            setReferenceData(result.data);
            const wordIndex = {};

            result.data.forEach((row, rowIdx) => {
              let wordsToIndex = [];

              if (hasNewFormat) {
                // Handle new format with Word column
                const wordKey = headers.find(h => h.toLowerCase() === 'word');
                if (wordKey && row[wordKey]) {
                  const word = row[wordKey].toString().toLowerCase().trim();
                  if (word) {
                    wordsToIndex.push(word);
                  }
                }
              } else if (hasTSVFormat) {
                // Handle TSV format - find the "Word forms" column (case insensitive)
                const wordFormsKey = headers.find(h => h.toLowerCase().includes('word forms'));
                if (wordFormsKey && row[wordFormsKey]) {
                  const wordString = row[wordFormsKey].toString().toLowerCase();
                  // Split by comma or space, depending on the format
                  wordsToIndex = wordString.split(/[,\s]+/).filter(word => word.trim().length > 0);
                }
              } else if (hasCSVFormat) {
                // Handle original CSV format
                const wordFreqKey = headers.find(h => h.toLowerCase().includes('words (frequency)'));
                if (wordFreqKey && row[wordFreqKey]) {
                  const wordString = row[wordFreqKey].toString().toLowerCase();
                  const wordEntries = wordString.split(',');

                  for (const entry of wordEntries) {
                    const trimmed = entry.trim();
                    const match = trimmed.match(/^([^\(]+)(?:\s*\(\d+\))?/);
                    if (match) {
                      wordsToIndex.push(match[1].trim());
                    }
                  }
                }
              }

              // Index all words found
              wordsToIndex.forEach(word => {
                const cleanWord = word.toLowerCase().trim();
                if (cleanWord) {
                  if (!wordIndex[cleanWord]) {
                    wordIndex[cleanWord] = [];
                  }
                  wordIndex[cleanWord].push(rowIdx);
                }
              });
            });

            setIndexedData({ exact: wordIndex });
            setReferenceLoaded(true);
            setLoading(false);
            setError(`✓ ${fileType} data loaded successfully with ${result.data.length} entries`);
            setTimeout(() => setError(''), 3000);
          } else {
            setError('Reference data appears to be empty.');
            setLoading(false);
          }
        },
        error: (error) => {
          setError('Error parsing reference data: ' + error.message);
          setLoading(false);
        }
      });
    } catch (err) {
      setError('Failed to process reference data: ' + err.message);
      setLoading(false);
    }
  };

  // Parse user CSV
  const parseUserCSV = () => {
    if (!userCSV.trim()) return;

    try {
      Papa.parse(userCSV, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: (result) => {
          if (result.data.length > 0) {
            const firstRow = result.data[0];
            if (!('Word' in firstRow) && !('word' in firstRow)) {
              setError('CSV must have a "Word" column.');
              return;
            }

            const normalizedData = result.data.map(row => {
              const normalizedRow = {};
              Object.keys(row).forEach(key => {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'word') {
                  normalizedRow.Word = row[key];
                } else if (lowerKey === 'freq' || lowerKey === 'frequency') {
                  normalizedRow.Freq = row[key];
                } else {
                  normalizedRow[key] = row[key];
                }
              });
              return normalizedRow;
            });

            setCsvData(normalizedData);
            setCurrentBatch(1);
            setMatchedResults([]);
            setMatchStats({
              total: normalizedData.length,
              matched: 0,
              unmatched: 0,
              byPOS: {}
            });
            setParseProgress(0);
          } else {
            setError('CSV appears to be empty.');
          }
        },
        error: (error) => {
          setError('Error parsing your CSV: ' + error.message);
        }
      });
    } catch (err) {
      setError('Failed to process CSV: ' + err.message);
    }
  };

  // Find matches
  const findMatches = (word) => {
    if (!word || typeof word !== 'string') return [];

    const searchWord = word.toLowerCase().trim();
    let matches = [];

    // Try exact match first
    if (indexedData.exact && indexedData.exact[searchWord]) {
      matches = indexedData.exact[searchWord].map(idx => referenceData[idx]);
    }

    // Try transcription variants if Georgian characters detected
    if (matches.length === 0 && /[\u10A0-\u10FF]/.test(searchWord)) {
      const variants = createTranscriptionVariants(searchWord);

      for (const variant of variants) {
        if (indexedData.exact && indexedData.exact[variant]) {
          const variantMatches = indexedData.exact[variant].map(idx => {
            const match = { ...referenceData[idx] };
            match.transcriptionVariant = variant;
            return match;
          });
          matches.push(...variantMatches);
        }
      }
    }

    // Remove duplicates
    const uniqueMatches = matches.filter((match, index, self) =>
      index === self.findIndex(m => m.Lemma === match.Lemma)
    );

    return uniqueMatches;
  };

  // Process batch
  const processBatch = () => {
    if (csvData.length === 0) return;

    setProcessingBatch(true);
    const startIdx = (currentBatch - 1) * batchSize;
    const endIdx = Math.min(startIdx + batchSize, csvData.length);
    const currentItems = csvData.slice(startIdx, endIdx);

    setTimeout(() => {
      const batchResults = [];
      const newMatchStats = {...matchStats};

      currentItems.forEach((item, idx) => {
        const word = item.Word || '';
        const frequency = item.Freq || 0;
        const matches = findMatches(word);

        if (matches.length > 0) {
          newMatchStats.matched += 1;
          matches.forEach(match => {
            const pos = match.POS || 'Unknown';
            newMatchStats.byPOS[pos] = (newMatchStats.byPOS[pos] || 0) + 1;
          });
        } else {
          newMatchStats.unmatched += 1;
        }

        batchResults.push({
          word,
          frequency,
          matches,
          originalIndex: startIdx + idx
        });

        setParseProgress(Math.round(((startIdx + idx + 1) / csvData.length) * 100));
      });

      setMatchedResults(prev => [...prev, ...batchResults]);
      setMatchStats(newMatchStats);
      setProcessingBatch(false);

      if (resultsRef.current) {
        resultsRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  };

  // Process next batch
  const processNextBatch = () => {
    if (currentBatch * batchSize < csvData.length) {
      setCurrentBatch(prev => prev + 1);
    }
  };

  // Reset results
  const resetResults = () => {
    setCsvData([]);
    setMatchedResults([]);
    setParseProgress(0);
    setCurrentBatch(1);
    setMatchStats({
      total: 0,
      matched: 0,
      unmatched: 0,
      byPOS: {}
    });
  };

  // Copy to clipboard
  const copyResultsToClipboard = () => {
    if (matchedResults.length === 0) return;

    const headers = "Word\tFrequency\tLemma\tPOS\tGloss\tMorphemes\tMorpheme_Count\n";
    const rows = matchedResults.flatMap(result => {
      if (result.matches.length === 0) {
        return showUnmatched ? [`${result.word}\t${result.frequency}\t\t\t\t\t`] : [];
      }
      return result.matches.map(match =>
        `${result.word}\t${result.frequency}\t${match.Lemma || ''}\t${match.POS || ''}\t${match.Gloss || ''}\t${match.Morphemes || ''}\t${countMorphemes(match.Morphemes)}`
      );
    }).join('\n');

    navigator.clipboard.writeText(headers + rows)
      .then(() => {
        setError('Results copied to clipboard successfully!');
        setTimeout(() => setError(''), 3000);
      })
      .catch(() => {
        setError('Failed to copy results.');
        setTimeout(() => setError(''), 3000);
      });
  };

  // Effects
  useEffect(() => {
    if (csvData.length > 0 && !processingBatch) {
      processBatch();
    }
  }, [currentBatch, csvData]);

  // Calculations
  const hasMoreBatches = csvData.length > 0 && currentBatch * batchSize < csvData.length;
  const processedCount = Math.min(currentBatch * batchSize, csvData.length);
  const chartData = Object.entries(matchStats.byPOS)
    .map(([pos, count]) => ({
      pos,
      count,
      percentage: Math.round((count / matchStats.matched) * 100)
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Georgian-Latin Lemma Matcher</h1>

      {error && (
        <div className={`border px-4 py-3 rounded mb-4 ${
          error.includes('✓')
            ? 'bg-green-100 border-green-400 text-green-700'
            : 'bg-red-100 border-red-400 text-red-700'
        }`}>
          {error}
          <button className="float-right font-bold" onClick={() => setError('')}>×</button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-2"></div>
          <p>Processing data...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Step 1: Load reference data */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-xl font-semibold mb-3">Step 1: Load Reference Lemma Data</h2>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Paste your lemmatized reference data (CSV or TSV):
              </label>
              <textarea
                className="w-full p-2 border rounded h-32 font-mono text-sm"
                value={referenceCSV}
                onChange={(e) => setReferenceCSV(e.target.value)}
                placeholder="New format: Word[TAB]Frequency[TAB]Lemma[TAB]POS[TAB]Gloss[TAB]Morphemes&#10;OR&#10;CSV format: Words (Frequency),Lemma,Total,POS,Gloss&#10;OR&#10;TSV format: Word forms[TAB]Lemma[TAB]POS[TAB]Gloss"
                disabled={referenceLoaded}
              />
            </div>
            <div className="mb-3 text-sm text-gray-600">
              <p><strong>Supported formats:</strong></p>
              <ul className="list-disc pl-5 mt-1">
                <li><strong>New TSV:</strong> Headers "Word", "Frequency", "Lemma", "POS", "Gloss", "Morphemes"</li>
                <li><strong>CSV:</strong> Headers "Words (Frequency)", "Lemma", "POS", "Gloss"</li>
                <li><strong>TSV:</strong> Headers "Word forms", "Lemma", "POS", "Gloss"</li>
              </ul>
            </div>
            <div className="flex gap-3 items-center">
              {!referenceLoaded ? (
                <button
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                  onClick={loadReferenceData}
                  disabled={!referenceCSV.trim() || loading}
                >
                  Load Reference Data
                </button>
              ) : (
                <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">
                  ✓ Reference data loaded ({referenceData.length} entries)
                </div>
              )}
              {referenceLoaded && (
                <button
                  className="text-blue-600 hover:text-blue-800 text-sm"
                  onClick={() => {
                    setReferenceLoaded(false);
                    setReferenceData([]);
                    setIndexedData({});
                  }}
                >
                  Reset Reference Data
                </button>
              )}
            </div>
          </div>

          {/* Step 2: Input word list */}
          <div className={`bg-white p-4 rounded shadow ${!referenceLoaded ? 'opacity-50' : ''}`}>
            <h2 className="text-xl font-semibold mb-3">Step 2: Input Your Georgian Word List</h2>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Paste your CSV data with Georgian words:
              </label>
              <textarea
                className="w-full p-2 border rounded h-48 font-mono text-sm"
                value={userCSV}
                onChange={(e) => setUserCSV(e.target.value)}
                placeholder="Freq,Word&#10;1,ორი&#10;1,პუმბა&#10;1,კარაქი"
                disabled={!referenceLoaded}
              />
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <button
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                onClick={parseUserCSV}
                disabled={!referenceLoaded || !userCSV.trim() || processingBatch}
              >
                Parse CSV
              </button>
              <div className="flex items-center">
                <label className="text-sm font-medium text-gray-700 mr-2">Batch Size:</label>
                <select
                  className="border rounded p-1"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  disabled={!referenceLoaded}
                >
                  <option value={100}>100 words</option>
                  <option value={250}>250 words</option>
                  <option value={500}>500 words</option>
                  <option value={1000}>1000 words</option>
                </select>
              </div>
              {csvData.length > 0 && (
                <span className="text-sm text-gray-600">
                  {processedCount} of {csvData.length} words processed ({Math.round((processedCount / csvData.length) * 100)}%)
                </span>
              )}
              {csvData.length > 0 && (
                <button className="text-red-600 hover:text-red-800 text-sm" onClick={resetResults}>
                  Reset
                </button>
              )}
            </div>
            {parseProgress > 0 && parseProgress < 100 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
                <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${parseProgress}%` }}></div>
              </div>
            )}
          </div>

          {/* Step 3: Results */}
          {matchedResults.length > 0 && (
            <div className="bg-white p-4 rounded shadow" ref={resultsRef}>
              <h2 className="text-xl font-semibold mb-3">Step 3: Matching Results</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="bg-gray-50 p-3 rounded">
                  <h3 className="font-semibold mb-2">Summary</h3>
                  <ul className="space-y-1">
                    <li>Total Words: <span className="font-medium">{matchStats.total}</span></li>
                    <li>Words Processed: <span className="font-medium">{processedCount}</span></li>
                    <li>Matched Words: <span className="font-medium text-green-600">{matchStats.matched}</span> ({Math.round((matchStats.matched / processedCount) * 100)}%)</li>
                    <li>Unmatched Words: <span className="font-medium text-red-600">{matchStats.unmatched}</span> ({Math.round((matchStats.unmatched / processedCount) * 100)}%)</li>
                  </ul>
                </div>

                {chartData.length > 0 && (
                  <div className="bg-gray-50 p-3 rounded h-64">
                    <h3 className="font-semibold mb-2">POS Distribution</h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <BarChart data={chartData.slice(0, 10)} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="pos" />
                        <YAxis />
                        <Tooltip formatter={(value, name, props) => [`${value} (${props.payload.percentage}%)`, 'Count']} />
                        <Bar dataKey="count" fill="#3b82f6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3 mb-4">
                {hasMoreBatches && (
                  <button
                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                    onClick={processNextBatch}
                    disabled={processingBatch}
                  >
                    {processingBatch ? 'Processing...' : `Process Next Batch (${Math.min(batchSize, csvData.length - processedCount)} words)`}
                  </button>
                )}
                <button
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                  onClick={copyResultsToClipboard}
                  disabled={matchedResults.length === 0}
                >
                  Copy Results to Clipboard
                </button>
                <div className="flex items-center ml-auto">
                  <input
                    type="checkbox"
                    id="showUnmatched"
                    checked={showUnmatched}
                    onChange={(e) => setShowUnmatched(e.target.checked)}
                    className="mr-2"
                  />
                  <label htmlFor="showUnmatched" className="text-sm">Show unmatched words</label>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-4 py-2 text-left">Word</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Frequency</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Lemma</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">POS</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Gloss</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Morphemes</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Morpheme Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedResults.map((result) => {
                      if (result.matches.length === 0) {
                        if (!showUnmatched) return null;
                        return (
                          <tr key={`unmatched-${result.originalIndex}`} className="bg-red-50">
                            <td className="border border-gray-300 px-4 py-2">{result.word}</td>
                            <td className="border border-gray-300 px-4 py-2">{result.frequency}</td>
                            <td className="border border-gray-300 px-4 py-2 text-red-500">Not found</td>
                          </tr>
                        );
                      }

                      return result.matches.map((match, matchIdx) => (
                        <tr key={`match-${result.originalIndex}-${matchIdx}`} className={matchIdx > 0 ? "bg-blue-50" : ""}>
                          <td className="border border-gray-300 px-4 py-2">{matchIdx === 0 ? result.word : ""}</td>
                          <td className="border border-gray-300 px-4 py-2">{matchIdx === 0 ? result.frequency : ""}</td>
                          <td className="border border-gray-300 px-4 py-2">{match.Lemma}</td>
                          <td className="border border-gray-300 px-4 py-2">{match.POS}</td>
                          <td className="border border-gray-300 px-4 py-2">{match.Gloss}</td>
                          <td className="border border-gray-300 px-4 py-2 font-mono text-sm">{match.Morphemes}</td>
                          <td className="border border-gray-300 px-4 py-2 text-center font-medium">
                            {countMorphemes(match.Morphemes)}
                          </td>
                            <td className="border border-gray-300 px-4 py-2">-</td>
                            <td className="border border-gray-300 px-4 py-2">-</td>
                            <td className="border border-gray-300 px-4 py-2">-</td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>

              {hasMoreBatches && (
                <div className="mt-4 text-center">
                  <button
                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                    onClick={processNextBatch}
                    disabled={processingBatch}
                  >
                    {processingBatch ? 'Processing...' : `Process Next Batch (${Math.min(batchSize, csvData.length - processedCount)} words)`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          <div className="bg-blue-50 p-4 rounded">
            <h3 className="font-semibold mb-2">Instructions</h3>
            <ol className="list-decimal pl-5 space-y-1">
              <li><strong>Step 1:</strong> Paste your lemmatized reference data (CSV or TSV format) and click "Load Reference Data"</li>
              <li><strong>Step 2:</strong> Paste your Georgian word list CSV and click "Parse CSV"</li>
              <li><strong>Step 3:</strong> Process words in batches and review matches</li>
              <li>Use "Copy Results" to export all matches to clipboard</li>
            </ol>
            <p className="mt-2 text-sm text-gray-600">
              This tool supports both exact matching and Georgian-to-Latin transcription matching with multiple variant patterns.
              It now handles CSV, TSV, and the new morpheme-enhanced TSV format with columns: Word, Frequency, Lemma, POS, Gloss, Morphemes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
